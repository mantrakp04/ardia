import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error(`usage: node menus-test.mjs <Debug Ardia.app> [--keep-data] [--keep-running] [--only=<regex>]

Right-clicks the sidebar's rows, tiles, groups and background through AppKit's event path, picks items through the
appMenu and appDialog test hooks (docs/testing.md) and checks what each pick did to the store: the tab, several-tab,
group, sidebar, Top Apps, reload button and profile menus, moves between profiles and windows, and the page menu's
Back, Forward and Copy Link Address through the contextMenu hook.`);
  process.exit(2);
}
const appPath = resolve(appArg);
const keep = args.includes("--keep-data");
const onlyArg = args.find((a) => a.startsWith("--only="))?.slice(7);
const only = onlyArg ? new RegExp(onlyArg) : null;
const stay = args.includes("--keep-running");
const scratch = mkdtempSync(join(tmpdir(), "ac-menus-"));
const data = join(scratch, "data");
const downloads = join(scratch, "downloads");
const rep = reporter(join(scratch, "menus-test.log"), { name: "menus-test" });

const server = createServer((req, res) => {
  const name = req.url.slice(1).split("?")[0] || "root";
  if (name.startsWith("file")) {
    res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename=menutest-${name}.txt` });
    return res.end("menus-test download\n");
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>${name.toUpperCase()}</title><link rel="icon" href="data:,"><body style="margin:0;font:40px sans-serif">${name}<a id="l" href="/linked" style="display:block;height:300px;font-size:80px">LINK</a></body>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = (name) => `http://127.0.0.1:${server.address().port}/${name}`;
const tab = (id, extra = {}) => ({ id, url: url(id), title: id.toUpperCase(), ...extra });
const fixture = session({
  profiles: ["Personal", "Work"],
  windows: [{ id: "w1", frame: [80, 80, 1280, 800], activeTabIds: { default: "a" } }],
  tabs: [
    tab("p1", { pinned: true, pinnedUrl: url("p1") }),
    tab("p2", { pinned: true, pinnedUrl: url("p2") }),
    tab("pr", { pinned: true, pinnedUrl: url("pr"), pinnedAsRow: true }),
    ...["a", "b", "c", "d", "e", "f", "h"].map((id) => tab(id)),
  ],
  groups: [{ id: "g1", windowId: "w1", profileId: "default", name: "Grp", icon: null, color: null, collapsed: false, pinned: false, tabIds: ["d", "e"], createdAt: 1 }],
});

let app = null;
const HELPERS = `
const st = () => ac.store.getState();
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const mt = globalThis.__menusTest;
const act = (a, n = mt.n) => ac.engine.call("windows.dev", { window: n, action: a });
const pointOf = (target) => new Promise((r) => {
  if (target === "bg") return r([95, 640]);
  const [key, pane] = target.split("#");
  const item = mt.drag.items.get(key);
  const view = item && (item.header ?? item.view);
  if (!view) return r(null);
  view.measureInWindow((x, y, w, h) => {
    const n = item.tabIds.length;
    r(pane === undefined ? [Math.round(x + Math.min(w / 2, 60)), Math.round(y + h / 2)] : [Math.round(x + (w * (Number(pane) + 0.5)) / n), Math.round(y + h / 2)]);
  });
});
const rightClick = (target) => pointOf(target).then((p) => (p ? act("click:" + p[0] + "," + p[1] + ",right") : "no item " + target));
const byUrl = (name) => Object.values(st().tabs).filter((t) => t.url.endsWith("/" + name));
const idOf = (name) => byUrl(name)[0]?.id;
const groupOfTab = (id) => Object.values(st().groups).find((g) => g.tabIds.includes(id)) ?? null;
const clip = () => settle(150).then(() => ac.menus.readClipboard());
const resetUi = () => ac.sidebarRows.setSidebarUi({ renaming: null, iconPicker: null });
const housed = (id) => { const t = st().tabs[id]; let g = groupOfTab(id); while (g?.parentId) g = st().groups[g.parentId]; return !!t.pin || !!g?.pinned; };
const regular = (w = "w1") => st().windows[w].tabIds.filter((id) => !housed(id) && st().tabs[id].profileId === st().windows[w].profileId);
const open = (names) => names.map((n) => st().newTab("w1", { url: "${url("")}" + n, background: true }));
const mkGroup = (name, names) => st().groupTabs(open(names), { pinned: false, name });
const groupNamed = (name) => Object.values(st().groups).find((g) => g.name === name);
const home = () => { if (st().windows.w1.profileId !== "default") st().switchProfile("w1", "default"); st().setSelection("w1", []); resetUi(); return settle(500); };
const select = (ids) => { st().setSelection("w1", ids); return settle(200); };
`;
const run = (body) => app.eval(`${HELPERS}\n${body}`, { timeout: 20000 });
const menuFile = () => join(data, "menu.json");
const dialog = () => JSON.parse(readFileSync(join(data, "dialog.json"), "utf8"));

function itemsOf(menu, id) {
  for (const item of menu) {
    if (item.id === id) return item;
    const found = item.children && itemsOf(item.children, id);
    if (found) return found;
  }
  return null;
}
const ids = (menu) => menu.filter((i) => !i.separator).map((i) => i.id);

async function choose(target, pick = null, { answer, open } = {}) {
  rmSync(menuFile(), { force: true });
  rmSync(`${menuFile()}.pick`, { force: true });
  rmSync(join(data, "dialog.json"), { force: true });
  rmSync(join(data, "dialog.json.pick"), { force: true });
  if (pick) writeFileSync(`${menuFile()}.pick`, pick);
  if (answer !== undefined) writeFileSync(join(data, "dialog.json.pick"), answer);
  const hit = await run(open ? `return Promise.resolve(${open}).then(() => "called");` : `return rightClick(${JSON.stringify(target)});`);
  for (const end = Date.now() + 4000; !existsSync(menuFile()); await sleep(50))
    if (Date.now() > end) throw new Error(`no menu from ${open ?? target} (hit: ${hit})`);
  await sleep(450);
  rep.log(`${open ?? target} → ${pick}: ${hit}`);
  return JSON.parse(readFileSync(menuFile(), "utf8"));
}
const tabMenuIn = (windowExpr, tabExpr) => `ac.menus.openTabMenu(${windowExpr}, st().tabs[${tabExpr}])`;

const check = (name, fn) => (only && !only.test(name) ? undefined : rep.check(name, fn));

try {
  app = await launch(appPath, { data, session: fixture, onboarded: true, test: { appMenu: true, appDialog: true, contextMenu: true }, instance: { downloadsDir: downloads } });
  rep.log(`instance: pid ${app.pid}, DevTools port ${app.port}, data ${data}`);
  await sleep(1500);
  await app.eval(`return ac.engine.call("windows.list").then((ws) => {
    globalThis.__menusTest = { n: ws.find((w) => w.hasRoot).window, drag: globalThis.sidebarDrag };
    return ac.engine.call("windows.dev", { window: globalThis.__menusTest.n, action: "fakeActiveClicks" });
  });`);

  await check("right-click wiring: row, tile, pinned row, group header, sidebar background each open their menu; no pick changes nothing", async () => {
    const before = await run(`return JSON.stringify([st().tabs, st().groups, st().windows]);`);
    const row = await choose("t:b");
    assert.deepEqual(ids(row).slice(0, 4), ["pin", "pinRow", "split", "duplicate"], "row menu");
    const tile = await choose("t:p1");
    assert.equal(ids(tile)[0], "pin", "tile menu");
    assert.ok(itemsOf(tile, "pinnedPage"), "tile has Edit Pinned Page");
    const pinnedRow = await choose("t:pr");
    assert.equal(ids(pinnedRow)[0], "pin", "pinned row menu");
    const group = await choose("g:g1");
    assert.deepEqual(ids(group).slice(0, 2), ["pin", "newTab"], "group menu");
    const bg = await choose("bg");
    assert.deepEqual(ids(bg).slice(0, 2), ["newTab", "reopen"], "sidebar menu");
    assert.equal(itemsOf(bg, "reopen").enabled, false, "Reopen Closed Tab is disabled with nothing closed");
    assert.equal(await run(`return JSON.stringify([st().tabs, st().groups, st().windows]);`), before);
  });

  await check("right-click wiring: the sidebar header and footer open the sidebar menu; the header still drags the window", async () => {
    for (const [x, y] of [[150, 12], [150, 785]]) {
      rmSync(menuFile(), { force: true });
      const hit = await run(`return act("click:${x},${y},right");`);
      for (const end = Date.now() + 4000; !existsSync(menuFile()); await sleep(50)) if (Date.now() > end) throw new Error(`no menu at ${x},${y} (hit: ${hit})`);
      await sleep(300);
      assert.deepEqual(ids(JSON.parse(readFileSync(menuFile(), "utf8"))).slice(0, 2), ["newTab", "reopen"], `sidebar menu at ${x},${y}`);
    }
    const drags = await run(`return act("windowDrags").then((t) => Number(t.split("\\n")[0]));`);
    await run(`return act("drag:150,12;170,30;220,60").then(() => settle(900));`);
    assert.equal(await run(`return act("windowDrags").then((t) => Number(t.split("\\n")[0]));`), drags + 1, "a drag on the header moves the window");
  });

  await check("tab: Duplicate, then Close on the copy", async () => {
    await choose("t:b", "duplicate");
    const copies = await run(`return byUrl("b").map((t) => t.id);`);
    assert.equal(copies.length, 2, "two tabs at /b");
    const copy = copies.find((id) => id !== "b");
    assert.deepEqual(await run(`const ids = st().windows.w1.tabIds; return ids.slice(ids.indexOf("b"), ids.indexOf("b") + 2);`), ["b", copy], "the copy sits right below");
    await choose(`t:${copy}`, "close");
    assert.equal(await run(`return byUrl("b").length;`), 1);
  });

  await check("sidebar: Reopen Closed Tab is enabled after a close and reopens it", async () => {
    const menu = await choose("bg", "reopen");
    assert.notEqual(itemsOf(menu, "reopen").enabled, false);
    await sleep(400);
    const back = await run(`return byUrl("b").map((t) => t.id).filter((id) => id !== "b");`);
    assert.equal(back.length, 1, "the closed copy came back");
    await run(`st().closeTabs(${JSON.stringify(back)}); return settle(300);`);
  });

  await check("tab: Mute Tab mutes only that tab, ⌥ Mute Site the site, and Unmute Site undoes both", async () => {
    const menu = await choose("t:b", "mute");
    assert.equal(itemsOf(menu, "muteSite").alternate, true);
    assert.deepEqual(await run(`return [st().tabs.b.muted, st().settings.mutedSites];`), [true, []]);
    assert.equal(itemsOf(await choose("t:b", "muteSite"), "mute").title, "Unmute Tab");
    assert.equal((await run(`return st().settings.mutedSites;`)).length, 1);
    const site = await choose("t:b", "mute");
    assert.equal(itemsOf(site, "mute").title, "Unmute Site");
    assert.equal(itemsOf(site, "muteSite"), null);
    assert.deepEqual(await run(`return [st().tabs.b.muted, st().settings.mutedSites];`), [false, []]);
  });

  await check("tab: Rename… starts the inline rename, Change Icon… opens the icon picker", async () => {
    await choose("t:b", "rename");
    assert.deepEqual(await run(`const r = ac.sidebarRows.useSidebarUi.getState().renaming; resetUi(); return r && [r.kind, r.id];`), ["tab", "b"]);
    await choose("t:b", "icon");
    assert.deepEqual(await run(`const p = ac.sidebarRows.useSidebarUi.getState().iconPicker; resetUi(); return p && [p.kind, p.id];`), ["tab", "b"]);
  });

  await check("tab: Rename… on a Top Apps tile asks for the name", async () => {
    await choose("t:p2", "rename", { answer: "Renamed Tile" });
    assert.equal(await run(`return st().tabs.p2.customTitle;`), "Renamed Tile");
    assert.equal(dialog().title, "Rename Tab");
  });

  await check("tab: Copy Link and its ⌥ alternate Copy Link as Markdown (scratch pasteboard)", async () => {
    const menu = await choose("t:b", "copy");
    assert.equal(itemsOf(menu, "copyMd").alternate, true);
    assert.deepEqual(itemsOf(menu, "copyMd").modifiers, ["option"]);
    assert.equal(await run(`return clip();`), url("b"));
    await choose("t:b", "copyMd");
    assert.equal(await run(`return clip();`), `[B](${url("b")})`);
  });

  await check("tab: Add to Bookmarks…, Add Bookmark to Folder › Bookmarks Bar and › New Folder…", async () => {
    await choose("t:b", "bookmark");
    assert.deepEqual(await run(`const o = ac.menus.useBookmarkDialog.getState().open; ac.menus.useBookmarkDialog.setState({ open: null }); return o && [o.kind, o.windowId];`), ["page", "w1"]);
    const where = (name) => `const s = st(); const roots = ac.bookmarks.bookmarkRoots(s, "default");
      return Object.values(s.bookmarks.nodes).filter((n) => n.kind === "url" && n.url.endsWith("/${name}")).map((n) => n.parentId === roots.bar ? "bar" : (s.bookmarks.nodes[n.parentId]?.title ?? n.parentId));`;
    assert.equal((await run(where("b"))).length, 1, "b bookmarked");
    await choose("t:c", "folder:bar");
    assert.deepEqual(await run(where("c")), ["bar"]);
    await choose("t:f", "folder:new", { answer: "MT Folder" });
    assert.deepEqual(await run(where("f")), ["MT Folder"]);
  });

  await check("tab: Open as Split on another tab splits it with the shown one, Remove from Split View on its pane", async () => {
    await run(`st().activate("a"); return settle(400);`);
    await choose("t:c", "split");
    const split = await run(`const s = Object.values(st().splits).find((s) => s.slots.flatMap((x) => x.stack ?? [x.tabId]).includes("c")); return s && { id: s.id, tabIds: s.slots.flatMap((x) => x.stack ?? [x.tabId]) };`);
    assert.deepEqual(split?.tabIds, ["a", "c"]);
    const menu = await choose(`s:${split.id}#1`, "unsplit");
    assert.ok(itemsOf(menu, "unsplit") && !itemsOf(menu, "split"), "the pane offers Remove from Split View");
    assert.ok(!(await run(`return Object.values(st().splits).some((s) => s.tabIds.includes("c"));`)), "c left the split");
  });

  await check("tab: Open as Split on the shown tab opens a New Tab beside it", async () => {
    await run(`st().activate("a"); return settle(400);`);
    await choose("t:a", "split");
    const split = await run(`const s = Object.values(st().splits).find((s) => s.tabIds.includes("a")); return s && s.tabIds.map((id) => st().tabs[id].url);`);
    assert.deepEqual(split, [url("a"), ""]);
    await run(`const s = Object.values(st().splits).find((s) => s.tabIds.includes("a")); st().closeTabs([s.tabIds[1]]); return settle(400);`);
    assert.ok(!(await run(`return Object.values(st().splits).some((s) => s.tabIds.includes("a"));`)));
  });

  await check("tab: New Group with Tab makes a pinned group whose member offers Unpin; Move to Group, Remove from Group", async () => {
    await choose("t:c", "newGroup");
    assert.equal(await run(`resetUi(); return groupOfTab("c")?.pinned;`), true, "c in a new pinned group");
    const member = await choose("t:c", "unpinMember");
    assert.ok(!itemsOf(member, "ungroupTab") && !itemsOf(member, "newGroup"), "a pinned group's member has Unpin in their place");
    assert.deepEqual(await run(`return [groupOfTab("c"), !!st().tabs.c.pin];`), [null, false]);
    const menu = await choose("t:b", "group:g1");
    assert.ok(itemsOf(menu, "group:g1"), "Move to Group lists Grp");
    assert.equal(await run(`return groupOfTab("b")?.id;`), "g1");
    await choose("t:b", "ungroupTab");
    assert.equal(await run(`return groupOfTab("b");`), null);
  });

  await check("tab: Move to Profile › Work (warning confirmed), cancelled at the warning moves nothing", async () => {
    const menu = await choose("t:h", "profile:work", { answer: "confirm" });
    assert.equal(itemsOf(menu, "profile:default").checked, true);
    assert.equal(itemsOf(menu, "profile:default").enabled, false);
    assert.equal(dialog().title, "Move Tab to Profile?");
    assert.deepEqual(await run(`return byUrl("h").map((t) => [t.profileId, t.windowId]);`), [["work", "w1"]]);
    await run(`return home();`);
    await choose("t:f", "profile:work", { answer: "cancel" });
    assert.deepEqual(await run(`return byUrl("f").map((t) => t.profileId);`), ["default"]);
  });

  await check("tab: Move to Window › New Window, then back into w1 from there (the last tab of a window)", async () => {
    await run(`return home();`);
    await choose("t:c", "window:new");
    const [moved] = await run(`return byUrl("c").map((t) => t.windowId);`);
    assert.notEqual(moved, "w1");
    const menu = await choose("t:f", `window:${moved}`);
    assert.ok(itemsOf(menu, `window:${moved}`), "the new window is listed");
    assert.deepEqual(await run(`return byUrl("f").map((t) => t.windowId);`), [moved]);
    await choose(null, "window:w1", { open: tabMenuIn(JSON.stringify(moved), `idOf("f")`) });
    await choose(null, "window:w1", { open: tabMenuIn(JSON.stringify(moved), `idOf("c")`) });
    await sleep(800);
    const after = await run(`return { c: byUrl("c").map((t) => t.windowId), f: byUrl("f").map((t) => t.windowId), gone: !st().windows[${JSON.stringify(moved)}] || st().windows[${JSON.stringify(moved)}].tabIds.every((id) => !!st().tabs[id].pin) };`);
    assert.deepEqual(after.c, ["w1"]);
    assert.deepEqual(after.f, ["w1"]);
    assert.ok(after.gone, "the emptied window closed or holds no regular tab");
  });

  await check("tab: a split pane moved to a New Window leaves its partner whole in w1", async () => {
    await run(`return home().then(() => { st().activate("a"); return settle(300); });`);
    await choose("t:c", "split");
    const split = await run(`return Object.values(st().splits).find((s) => s.tabIds.includes("c"))?.id;`);
    await choose(`s:${split}#1`, "window:new");
    const r = await run(`return { c: byUrl("c").map((t) => t.windowId), a: byUrl("a").map((t) => t.windowId), splits: Object.values(st().splits).map((s) => s.tabIds) };`);
    assert.notEqual(r.c[0], "w1");
    assert.deepEqual(r.a, ["w1"]);
    assert.ok(!r.splits.some((t) => t.includes("a") || t.includes("c")), `no broken split left: ${JSON.stringify(r.splits)}`);
    await choose(null, "window:w1", { open: tabMenuIn(JSON.stringify(r.c[0]), `idOf("c")`) });
  });

  await check("tab: Move to Window on a Top Apps tile", async () => {
    await run(`return home();`);
    const target = await run(`return st().createWindow({ url: "${url("tilewin")}" });`);
    await sleep(1500);
    await choose("t:p2", `window:${target}`);
    const r = await run(`const s = st(); return { tiles: Object.values(s.tabs).filter((t) => t.url.endsWith("/p2")).map((t) => [t.windowId, !!t.pin]), w1: s.windows.w1.tabIds.includes("p2") };`);
    rep.log(`p2 after Move to Window: ${JSON.stringify(r)}`);
    assert.equal(r.tiles.filter(([w]) => w === target).length, 1, `one p2 in the target window: ${JSON.stringify(r)}`);
    await run(`st().closeWindow(${JSON.stringify(target)}); return settle(800);`);
  });

  await check("several tabs: Copy N Links, New Group with N Tabs, Remove from Group", async () => {
    await run(`return home().then(() => { open(["m1", "m2", "m3"]); return settle(600); });`);
    const [m1, m2] = await run(`return [idOf("m1"), idOf("m2")];`);
    await run(`return select(${JSON.stringify([m1, m2])});`);
    const menu = await choose(`t:${m1}`, "copy");
    assert.equal(itemsOf(menu, "copy").title, "Copy 2 Links");
    assert.equal(await run(`return clip();`), `${url("m1")}\n${url("m2")}`);
    await choose(`t:${m1}`, "copyMd");
    assert.equal(await run(`return clip();`), `- [M1](${url("m1")})\n- [M2](${url("m2")})`);
    await run(`return select(${JSON.stringify([m1, m2])});`);
    await choose(`t:${m2}`, "newGroup");
    const groups = await run(`resetUi(); return [groupOfTab(${JSON.stringify(m1)})?.id, groupOfTab(${JSON.stringify(m2)})?.id];`);
    assert.ok(groups[0] && groups[0] === groups[1], "one group holds both");
    await run(`return select(${JSON.stringify([m1, m2])});`);
    await choose(`t:${m1}`, "ungroup");
    assert.deepEqual(await run(`return [groupOfTab(${JSON.stringify(m1)}), groupOfTab(${JSON.stringify(m2)})];`), [null, null]);
  });

  await check("several tabs: Move 2 Tabs to Profile › Work", async () => {
    await run(`return home();`);
    const [m1, m2] = await run(`return [idOf("m1"), idOf("m2")];`);
    await run(`return select(${JSON.stringify([m1, m2])});`);
    const menu = await choose(`t:${m1}`, "profile:work", { answer: "confirm" });
    assert.equal(itemsOf(menu, "moveToProfile").title, "Move 2 Tabs to Profile");
    assert.equal(dialog().title, "Move 2 Tabs to Profile?");
    assert.deepEqual(await run(`return [byUrl("m1")[0].profileId, byUrl("m2")[0].profileId];`), ["work", "work"]);
  });

  await check("several tabs: Move to Window › New Window and › an existing window, Close 2 Tabs", async () => {
    await run(`return home().then(() => { open(["n1", "n2", "n3", "n4", "n5", "n6"]); return settle(600); });`);
    const [n1, n2, n3, n4, n5, n6] = await run(`return ["n1", "n2", "n3", "n4", "n5", "n6"].map(idOf);`);
    await run(`return select(${JSON.stringify([n1, n2])});`);
    await choose(`t:${n1}`, "window:new");
    const where = await run(`return [byUrl("n1")[0].windowId, byUrl("n2")[0].windowId];`);
    assert.ok(where[0] !== "w1" && where[0] === where[1], `both in one new window: ${where}`);
    await run(`return home().then(() => select(${JSON.stringify([n5, n6])}));`);
    await choose(`t:${n5}`, `window:${where[0]}`);
    assert.deepEqual(await run(`return [byUrl("n5")[0].windowId, byUrl("n6")[0].windowId];`), [where[0], where[0]]);
    await run(`return home().then(() => select(${JSON.stringify([n3, n4])}));`);
    const menu = await choose(`t:${n3}`, "close");
    assert.equal(itemsOf(menu, "close").title, "Close 2 Tabs");
    assert.equal(itemsOf(menu, "close").key, undefined, "no ⌘W on Close 2 Tabs");
    assert.deepEqual(await run(`return [byUrl("n3").length, byUrl("n4").length];`), [0, 0]);
    await run(`st().closeWindow(${JSON.stringify(where[0])}); return settle(800);`);
  });

  await check("group: Rename…, Color, Pin Group / Unpin Group", async () => {
    await run(`return home();`);
    await choose("g:g1", "rename");
    assert.deepEqual(await run(`const r = ac.sidebarRows.useSidebarUi.getState().renaming; resetUi(); return r && [r.kind, r.id];`), ["group", "g1"]);
    const colors = await choose("g:g1");
    const color = itemsOf(colors, "color").children.filter((c) => c.id && c.id !== "color:" && !c.checked).at(-1).id;
    await choose("g:g1", color);
    assert.equal(await run(`return st().groups.g1.color;`), color.slice(6));
    await choose("g:g1", "pin");
    assert.equal(await run(`return st().groups.g1.pinned;`), true);
    const pinned = await choose("g:g1", "pin");
    assert.equal(itemsOf(pinned, "pin").title, "Unpin Group");
    assert.ok(!itemsOf(pinned, "moveToWindow"), "a pinned group has no Move to Window");
    assert.equal(await run(`return st().groups.g1.pinned;`), false);
  });

  await check("group: New Tab in Group, Duplicate Group, Copy All Links", async () => {
    const before = await run(`return st().groups.g1.tabIds.length;`);
    await choose("g:g1", "newTab");
    const opened = await run(`const p = st().windowUi.w1?.panel; return { tabs: st().groups.g1.tabIds.length, panel: p?.newTab ? JSON.stringify(p) : null };`);
    assert.ok(opened.tabs === before + 1 || (opened.panel && opened.panel.includes("g1")), `a tab or the New Tab bar for g1: ${JSON.stringify(opened)}`);
    await run(`if (st().windowUi.w1?.panel?.open) st().closePanel("w1"); st().groups.g1.tabIds.filter((id) => !st().tabs[id].url).forEach((id) => st().closeTabs([id])); return settle(300);`);
    const groupsBefore = await run(`return Object.keys(st().groups).length;`);
    await choose("g:g1", "duplicate");
    assert.equal(await run(`return Object.keys(st().groups).length;`), groupsBefore + 1);
    const copy = await run(`return Object.values(st().groups).filter((g) => g.name === "Grp" && g.id !== "g1").map((g) => g.tabIds.map((id) => st().tabs[id].url));`);
    assert.deepEqual(copy, [[url("d"), url("e")]]);
    await choose("g:g1", "copy");
    assert.equal(await run(`return clip();`), `${url("d")}\n${url("e")}`);
    await choose("g:g1", "copyMd");
    assert.equal(await run(`return clip();`), `- [D](${url("d")})\n- [E](${url("e")})`);
  });

  await check("group: Ungroup (the copy), Move to Bookmarks Bar, Close Group, Delete Group", async () => {
    const copy = await run(`return Object.values(st().groups).find((g) => g.name === "Grp" && g.id !== "g1").id;`);
    const copyTabs = await run(`return st().groups[${JSON.stringify(copy)}].tabIds;`);
    await choose(`g:${copy}`, "ungroup");
    assert.equal(await run(`return !!st().groups[${JSON.stringify(copy)}];`), false);
    assert.ok(await run(`return ${JSON.stringify(copyTabs)}.every((id) => st().tabs[id]);`), "its tabs stay");
    await run(`st().closeTabs(${JSON.stringify(copyTabs)}); mkGroup("ToBar", ["bb1", "bb2"]); return settle(500);`);
    const toBar = await run(`return groupNamed("ToBar").id;`);
    await choose(`g:${toBar}`, "bookmarkBar");
    assert.deepEqual(await run(`const s = st(); const f = Object.values(s.bookmarks.nodes).find((n) => n.kind === "folder" && n.title === "ToBar"); return f && [f.parentId === ac.bookmarks.bookmarkRoots(s, "default").bar, f.children.map((id) => s.bookmarks.nodes[id].url), !!groupNamed("ToBar"), byUrl("bb1").length];`), [true, [url("bb1"), url("bb2")], false, 0]);
    await run(`mkGroup("ToClose", ["cg1"]); return settle(500);`);
    const closeMenu = await choose(`g:${await run(`return groupNamed("ToClose").id;`)}`, "close", { answer: "confirm" });
    rep.log(`Close Group title: ${itemsOf(closeMenu, "close").title}; dialog: ${dialog().title}`);
    assert.deepEqual(await run(`return [!!groupNamed("ToClose"), st().closedGroups.some((c) => c.group.name === "ToClose"), byUrl("cg1").length];`), [false, true, 0]);
    await run(`mkGroup("ToDelete", ["dg1"]); return settle(500);`);
    await choose(`g:${await run(`return groupNamed("ToDelete").id;`)}`, "delete");
    assert.deepEqual(await run(`return [!!groupNamed("ToDelete"), byUrl("dg1").length];`), [false, 0]);
  });

  await check("group: a nested group has no Pin Group; Move to Window › New Window moves a group whole", async () => {
    await choose("g:g1", "nest");
    const child = await run(`resetUi(); return Object.values(st().groups).find((g) => g.parentId === "g1")?.id;`);
    assert.ok(child, "a nested group");
    await sleep(300);
    const menu = await choose(`g:${child}`);
    assert.ok(!itemsOf(menu, "pin"), "no Pin Group on a nested group");
    await run(`st().groups[${JSON.stringify(child)}]?.tabIds.forEach((id) => st().closeTabs([id])); mkGroup("ToWindow", ["wg1", "wg2"]); return settle(500);`);
    await choose(`g:${await run(`return groupNamed("ToWindow").id;`)}`, "window:new");
    const r = await run(`const g = groupNamed("ToWindow"); return g && { w: g.windowId, tabs: g.tabIds.map((id) => st().tabs[id].windowId) };`);
    assert.notEqual(r.w, "w1");
    assert.deepEqual(r.tabs, [r.w, r.w]);
    await run(`st().closeWindow(${JSON.stringify(r.w)}); return settle(800);`);
  });

  await check("group: Move to Profile › Work moves the group and its tabs; a pinned group too", async () => {
    await run(`return home().then(() => { mkGroup("ToWork", ["pg1"]); return settle(500); });`);
    await choose(`g:${await run(`return groupNamed("ToWork").id;`)}`, "profile:work", { answer: "confirm" });
    assert.deepEqual(await run(`const g = groupNamed("ToWork"); return g && [g.profileId, byUrl("pg1").map((t) => t.profileId)];`), ["work", ["work"]]);
    await run(`return home().then(() => { st().groupTabs(open(["pp1"]), { pinned: true, name: "PinnedToWork" }); return settle(500); });`);
    const pinnedGroup = await run(`return groupNamed("PinnedToWork").id;`);
    const menu = await choose(`g:${pinnedGroup}`, "profile:work", { answer: "confirm" });
    assert.ok(!itemsOf(menu, "moveToWindow"));
    assert.deepEqual(await run(`const g = groupNamed("PinnedToWork"); return g && [g.profileId, g.pinned, [...new Set(byUrl("pp1").map((t) => t.profileId))]];`), ["work", true, ["work"]]);
  });

  await check("Top Apps tile: Edit Pinned Page › Back to Pinned URL (disabled at the pinned URL), Open in New Window, Unpin", async () => {
    await run(`return home();`);
    const atPin = await choose("t:p1");
    assert.equal(itemsOf(atPin, "backToPin").enabled, false);
    await run(`st().activate("p1"); st().navigate("p1", "${url("away")}"); return settle(1500);`);
    const away = await choose("t:p1", "backToPin");
    assert.notEqual(itemsOf(away, "backToPin").enabled, false, "enabled once away");
    await sleep(1000);
    assert.equal(await run(`return st().tabs.p1.url;`), url("p1"));
    const windows = await run(`return st().windowOrder.length;`);
    await choose("t:p1", "newWindow");
    const w = await run(`return st().windowOrder.length === ${windows} + 1 && st().windowOrder.at(-1);`);
    assert.ok(w, "a new window");
    assert.ok(await run(`return st().windows[${JSON.stringify(w)}].tabIds.some((id) => !st().tabs[id].pin && st().tabs[id].url === "${url("p1")}");`), "showing p1's page");
    await run(`st().closeWindow(${JSON.stringify(w)}); return settle(800);`);
    await choose("t:p1", "pin");
    assert.equal(await run(`return !!st().tabs.p1?.pin ?? false;`), false);
  });

  await check("sidebar: New Tab, New Group, Bookmark All Tabs…", async () => {
    await run(`return home();`);
    const tabs = await run(`return Object.keys(st().tabs).length;`);
    await choose("bg", "newTab");
    const after = await run(`const p = st().windowUi.w1?.panel; return { tabs: Object.keys(st().tabs).length, panel: !!p?.newTab };`);
    assert.ok(after.tabs === tabs + 1 || after.panel, `a New Tab: ${JSON.stringify(after)}`);
    await run(`if (st().windowUi.w1?.panel?.open) st().closePanel("w1"); return settle(300);`);
    const groups = await run(`return Object.values(st().groups).filter((g) => g.windowId === "w1").length;`);
    await choose("bg", "newGroup");
    assert.equal(await run(`resetUi(); return Object.values(st().groups).filter((g) => g.windowId === "w1").length;`), groups + 1);
    await choose("bg", "bookmarkAll");
    assert.deepEqual(await run(`const o = ac.menus.useBookmarkDialog.getState().open; ac.menus.useBookmarkDialog.setState({ open: null }); return o && [o.kind, o.windowId, o.tabs.length > 3];`), ["allTabs", "w1", true]);
  });

  await check("reload button: Block Ads & Trackers off, then on again, for the site", async () => {
    await run(`st().activate("b"); return settle(600);`);
    const open = `ac.menus.showReloadMenu("b")`;
    const on = await choose(null, "blocking", { open });
    assert.equal(itemsOf(on, "blocking").checked, true, "blocking starts on");
    await sleep(800);
    const off = await choose(null, "blocking", { open });
    assert.equal(itemsOf(off, "blocking").checked, false, "off after the first pick");
    await sleep(800);
    const again = await choose(null, null, { open });
    assert.equal(itemsOf(again, "blocking").checked, true, "on again");
  });

  await check("reload button: Clear Cookies and Site Data… clears the site's cookie and storage", async () => {
    await run(`st().navigate("b", "${url("cookie")}"); return settle(2000);`);
    const set = await app.page("/cookie");
    await set.eval(`document.cookie = "menutest=1; max-age=86400; path=/"; localStorage.setItem("menutest", "1"); document.cookie`);
    set.close();
    await choose(null, "clearData", { open: `ac.menus.showReloadMenu("b")`, answer: "confirm" });
    assert.equal(dialog().title, "Clear cookies and site data for 127.0.0.1?");
    await sleep(2500);
    const page = await app.page("/cookie");
    const after = await page.eval(`[document.cookie, localStorage.getItem("menutest")]`);
    page.close();
    assert.deepEqual(after, ["", null]);
    await run(`st().navigate("b", "${url("b")}"); return settle(1000);`);
  });

  await check("profile menu: Rename…, Color, Profile Settings… opens Settings › Profiles", async () => {
    const open = (id) => `ac.menus.openProfileItemMenu("${id}", "sidebar", "w1")`;
    await choose(null, "rename", { open: open("work"), answer: "Office" });
    assert.equal(await run(`return st().profiles.work.name;`), "Office");
    const menu = await choose(null, null, { open: open("work") });
    const color = itemsOf(menu, "color").children.find((c) => !c.checked).id;
    await choose(null, color, { open: open("work") });
    assert.equal(await run(`return st().profiles.work.color;`), color.slice(6));
    await choose(null, "settings", { open: open("work") });
    await sleep(1200);
    assert.deepEqual(await run(`const n = ac.settingsNav.getState(); return [n.pane, n.profileId];`), ["profiles", "work"]);
  });

  await check("incognito: a private window's tab can't move to a profile or window, and isn't a destination", async () => {
    await run(`return home();`);
    const w = await run(`const w = ac.actions.openWindow({ kind: "private", url: "${url("inc")}" }); return settle(2500).then(() => w);`);
    const inc = await run(`return idOf("inc");`);
    assert.ok(inc, "a private tab");
    const items = await choose(null, null, { open: tabMenuIn(JSON.stringify(w), JSON.stringify(inc)) });
    assert.equal(itemsOf(items, "moveToProfile").enabled, false);
    assert.equal(itemsOf(items, "moveToWindow").enabled, false);
    const regularMenu = await choose("t:a");
    assert.ok(!itemsOf(regularMenu, `window:${w}`), "the private window isn't offered");
    await run(`st().closeWindow(${JSON.stringify(w)}); return settle(800);`);
  });

  await check("page menu (contextMenu hook): Copy Link Address, Save Link As… (cancelled), Back, Forward", async () => {
    await run(`return home().then(() => { st().navigate("b", "${url("pagemenu")}"); st().activate("b"); return settle(2500); });`);
    const pageFile = join(data, "context-menu.json");
    const rightClickPage = async (x, y, pick) => {
      rmSync(pageFile, { force: true });
      if (pick) writeFileSync(`${pageFile}.pick`, pick);
      const hit = await run(`return act("click:${x},${y},right");`);
      for (const end = Date.now() + 4000; !existsSync(pageFile); await sleep(50)) if (Date.now() > end) throw new Error(`no page menu (hit: ${hit})`);
      await sleep(800);
      return JSON.parse(readFileSync(pageFile, "utf8"));
    };
    const link = await rightClickPage(600, 200, "Copy Link Address");
    assert.equal(link.link, url("linked"), `the link: ${JSON.stringify(link).slice(0, 300)}`);
    assert.equal(await run(`return clip();`), url("linked"));
    rmSync(join(data, "file-chooser.txt"), { force: true });
    const save = await rightClickPage(600, 200, "Save Link As…");
    assert.ok(save.items.some((i) => i.label === "Save Link As…" && i.enabled), "Save Link As… offered on a link");
    await sleep(1500);
    assert.deepEqual(await run(`return [st().downloads.filter((d) => d.url.endsWith("/linked")).length, !!st().windowUi.w1?.downloadsOpen];`), [0, false], "a cancelled save lists nothing and opens no downloads popover");
    await run(`st().navigate("b", "${url("second")}"); return settle(1500);`);
    await rightClickPage(600, 600, "Back");
    await sleep(1200);
    assert.equal(await run(`return st().tabs.b.url;`), url("pagemenu"), "Back went to the first page");
    const blank = await rightClickPage(600, 600, "Forward");
    assert.ok(blank.items.some((i) => i.label === "Forward" && i.enabled), "Forward enabled after Back");
    await sleep(1200);
    assert.equal(await run(`return st().tabs.b.url;`), url("second"), "Forward came back");
  });

  await check("profile menu: Delete Profile… deletes Work, and is disabled on the last profile", async () => {
    const open = (id) => `ac.menus.openProfileItemMenu("${id}", "sidebar", "w1")`;
    await run(`return home();`);
    await choose(null, "delete", { open: open("work"), answer: "confirm" });
    await sleep(800);
    assert.deepEqual(await run(`return st().profileOrder;`), ["default"]);
    const menu = await choose(null, "delete", { open: open("default") });
    assert.equal(itemsOf(menu, "delete").enabled, false);
    assert.deepEqual(await run(`return st().profileOrder;`), ["default"]);
  });

  await check("bookmarks page: a two-bookmark selection opens both, copies both, and Delete 2 Bookmarks reaches the page's delete", async () => {
    await run(`return home();`);
    const [b1, b2] = await run(`return [st().addBookmark({ profileId: "default", url: "${url("bm1")}", title: "BM1" }), st().addBookmark({ profileId: "default", url: "${url("bm2")}", title: "BM2" })];`);
    const open = `ac.menus.openBookmarkRowMenu(st().bookmarks.nodes[${JSON.stringify(b1)}], { windowId: "w1", profileId: "default", showPath: false, selection: ${JSON.stringify([b1, b2])}, onOpenFolder() {}, onDelete() { globalThis.__menusDeleted = (globalThis.__menusDeleted ?? 0) + 1; } })`;
    const menu = await choose(null, "openAll", { open });
    assert.equal(itemsOf(menu, "delete").title, "Delete 2 Bookmarks");
    assert.equal(itemsOf(menu, "openAll").title, "Open 2 in New Tabs");
    await sleep(800);
    assert.deepEqual(await run(`return [byUrl("bm1").length, byUrl("bm2").length];`), [1, 1]);
    await choose(null, "copy", { open });
    assert.equal(await run(`return clip();`), `${url("bm1")}\n${url("bm2")}`);
    await choose(null, "delete", { open });
    assert.equal(await run(`return globalThis.__menusDeleted;`), 1);
  });

  await check("bookmarks bar: Delete on a bar bookmark removes it", async () => {
    const id = await run(`return st().addBookmark({ profileId: "default", url: "${url("barbm")}", title: "BarBM" });`);
    await choose(null, "delete", { open: `ac.menus.openBarMenu("w1", "default", st().bookmarks.nodes[${JSON.stringify(id)}])` });
    assert.equal(await run(`return !!st().bookmarks.nodes[${JSON.stringify(id)}];`), false);
  });

  await check("history: Remove 2 Pages from History… asks, and removes only when confirmed", async () => {
    const entries = JSON.stringify([{ url: url("h1"), title: "H1" }, { url: url("h2"), title: "H2" }]);
    const open = `ac.menus.openHistoryRowMenu(${entries}, "w1", () => {}, (urls) => { globalThis.__menusRemoved = urls; })`;
    await run(`globalThis.__menusRemoved = null; return null;`);
    const menu = await choose(null, "remove", { open, answer: "cancel" });
    assert.equal(itemsOf(menu, "remove").title, "Remove 2 Pages from History…");
    assert.equal(dialog().title, "Remove selected items?");
    assert.equal(await run(`return globalThis.__menusRemoved;`), null);
    await choose(null, "remove", { open, answer: "confirm" });
    assert.deepEqual(await run(`return globalThis.__menusRemoved;`), [url("h1"), url("h2")]);
  });

  await check("downloads: Remove from List keeps the file, Move to Trash removes it (scratch downloads only)", async () => {
    const fetchFile = async (name) => {
      await run(`ac.actions.openUrls(["${url("")}${name}"], "w1"); return settle(300);`);
      for (const end = Date.now() + 15000; ; await sleep(250)) {
        const d = await run(`return st().downloads.find((d) => d.url.endsWith("/${name}") && d.state === "finished") ?? null;`);
        if (d) return d;
        if (Date.now() > end) throw new Error(`${name} never finished downloading`);
      }
    };
    const first = await fetchFile("file1");
    assert.ok(first.path.startsWith(downloads), `downloaded into the scratch dir: ${first.path}`);
    await choose(null, "remove", { open: `ac.menus.downloadMenu(st().downloads.find((d) => d.id === ${JSON.stringify(first.id)}), "w1")` });
    assert.equal(await run(`return st().downloads.some((d) => d.id === ${JSON.stringify(first.id)});`), false);
    assert.ok(existsSync(first.path), "the file stays");
    const second = await fetchFile("file2");
    const menu = await choose(null, "trash", { open: `ac.menus.downloadMenu(st().downloads.find((d) => d.id === ${JSON.stringify(second.id)}), "w1")` });
    assert.equal(ids(menu).at(-1), "trash");
    await sleep(800);
    assert.equal(existsSync(second.path), false, "the file went to the Trash");
    assert.equal(await run(`return st().downloads.some((d) => d.id === ${JSON.stringify(second.id)});`), false);
    await run(`st().setDownloadsOpen("w1", false); return settle(300);`);
  });

  await check("extension menu: Pin to Toolbar and back, Turn Off and On, Remove Extension… (a scratch unpacked extension)", async () => {
    const dir = join(scratch, "extension");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "Menus Test Extension", version: "1.0", action: { default_title: "Menus Test" } }));
    writeFileSync(join(data, "file-chooser.txt"), `${dir}\n`);
    const list = `const profile = ac.extensions.extensionProfile(st(), "w1"); return ac.extensions.refreshExtensions(profile).then((l) => l.find((x) => x.name === "Menus Test Extension") ?? null);`;
    await run(`return ac.extensions.loadUnpacked("w1").then(() => settle(500)).then(() => ac.extensions.confirmInstall()).then(() => settle(500));`);
    const ext = await run(list);
    assert.ok(ext, "installed");
    const open = `Promise.resolve(ac.extensions.refreshExtensions(ac.extensions.extensionProfile(st(), "w1"))).then((l) => ac.extensions.showExtensionMenu("w1", l.find((x) => x.name === "Menus Test Extension")))`;
    const menu = await choose(null, "pin", { open });
    assert.deepEqual(ids(menu), ["name", "options", "pin", "enable", "manage", "remove"]);
    await sleep(800);
    assert.equal((await run(list)).pinned, !ext.pinned, "pin toggled");
    await choose(null, "pin", { open });
    await sleep(800);
    assert.equal((await run(list)).pinned, ext.pinned, "pin back");
    await choose(null, "enable", { open });
    await sleep(800);
    assert.equal((await run(list)).enabled, false, "turned off");
    const off = await choose(null, "enable", { open });
    assert.equal(itemsOf(off, "enable").title, "Turn On");
    await sleep(800);
    assert.equal((await run(list)).enabled, true, "turned on");
    await choose(null, "remove", { open, answer: "confirm" });
    await sleep(1200);
    assert.equal(await run(list), null, "removed");
  });

  await check("tab: Close Tabs Below and ⌥ Close Tabs Above; Close Tabs Below disabled on the last row; Close Other Tabs", async () => {
    await run(`return home();`);
    const last = await run(`return regular().at(-1);`);
    const lastMenu = await choose(`t:${last}`);
    assert.equal(itemsOf(lastMenu, "closeBelow").enabled, false, "nothing below the last row");
    assert.equal(itemsOf(lastMenu, "closeAbove").alternate, true);
    await run(`return home().then(() => { open(["k1", "k2", "k3"]); return settle(600); });`);
    const [k1, k2, k3] = await run(`return ["k1", "k2", "k3"].map(idOf);`);
    await choose(`t:${k2}`, "closeBelow");
    assert.deepEqual(await run(`return [!!st().tabs[${JSON.stringify(k3)}], !!st().tabs[${JSON.stringify(k2)}], !!st().tabs[${JSON.stringify(k1)}]];`), [false, true, true]);
    await choose(`t:${k2}`, "closeAbove");
    assert.deepEqual(await run(`return regular();`), [k2]);
    assert.ok(await run(`return byUrl("p2").some((t) => !!t.pin && t.windowId === "w1") && !!st().tabs.pr?.pin;`), "pinned items stay");
    await run(`open(["o1", "o2"]); return settle(600);`);
    await choose(`t:${k2}`, "closeOthers");
    assert.deepEqual(await run(`return regular();`), [k2]);
  });

  await check("several tabs: Close Other Tabs; sidebar: Close All Tabs", async () => {
    await run(`open(["q1", "q2", "q3"]); return settle(600);`);
    const [q1, q2] = await run(`return ["q1", "q2"].map(idOf);`);
    await run(`return select(${JSON.stringify([q1, q2])});`);
    await choose(`t:${q1}`, "closeOthers");
    assert.deepEqual((await run(`return regular();`)).sort(), [q1, q2].sort());
    await run(`st().activate(${JSON.stringify(q1)}); return settle(300);`);
    await choose("bg", "closeAll");
    assert.deepEqual(await run(`return regular();`), [q1], "everything but the shown tab");
    assert.ok(await run(`return byUrl("p2").some((t) => !!t.pin && t.windowId === "w1");`), "pinned items stay");
  });
} finally {
  if (stay) rep.say(`still running: scripts/agent/ac eval ${data} …`);
  else await app?.quit();
  server.close();
  if (!keep && !stay) for (const dir of [data, downloads, join(scratch, "extension")]) rmSync(dir, { recursive: true, force: true });
  else rep.say(`data: ${data}`);
}
process.exit(rep.summary() ? 0 : 1);
