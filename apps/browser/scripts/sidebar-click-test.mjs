import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node sidebar-click-test.mjs <Debug Ardia.app> [--port=<DevTools port>] [--keep-data]\n\nOne click on a sidebar tab or pinned tile opens it, through AppKit's event path: as its hover card appears, under another tile's appearing card, after a New Tab, after closing a pinned tab, and when the pointer drifts up to 9 pt between press and release. A plain press switches on mouse down; a drag from it reorders the selected tab; ⌘/⇧-click, a press in a multi-selection, the shown tab, double-click rename, the close button, middle- and right-click keep their own behaviour.");
  process.exit(2);
}
const appPath = resolve(appArg);
const port = args.find((a) => a.startsWith("--port="))?.slice(7);
const keep = args.includes("--keep-data");
const scratch = mkdtempSync(join(tmpdir(), "ac-sidebar-click-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "sidebar-click-test.log"), { name: "sidebar-click-test" });

const server = createServer((req, res) => {
  const name = req.url.slice(1) || "root";
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>${name.toUpperCase()}</title><link rel="icon" href="data:,"><body style="font:40px sans-serif">${name}</body>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = (name) => `http://127.0.0.1:${server.address().port}/${name}`;
const tab = (id, extra = {}) => ({ id, url: url(id), title: id.toUpperCase(), ...extra });
const fixture = session({
  windows: [{ id: "w1", frame: [80, 80, 1280, 800], activeTabIds: { default: "a" } }],
  tabs: [
    tab("p1", { pinned: true, pinnedUrl: url("p1") }),
    tab("p2", { pinned: true, pinnedUrl: url("p2") }),
    tab("pr", { pinned: true, pinnedUrl: url("pr"), pinnedAsRow: true }),
    tab("a"), tab("b"), tab("c"), tab("e"),
  ],
});

let app = null;
const HELPERS = `
const st = () => ac.store.getState();
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const win = () => ac.engine.call("windows.list").then((ws) => ws.find((w) => w.hasRoot).window);
const act = (a) => win().then((n) => ac.engine.call("windows.dev", { window: n, action: a }));
const shown = () => st().windows.w1.activeTabIds[st().windows.w1.profileId];
const center = (id) => new Promise((r) => {
  const item = [...globalThis.sidebarDrag.items.values()].find((i) => i.view && i.tabIds.includes(id));
  item ? item.view.measureInWindow((x, y, w, h) => r([Math.round(x + Math.min(w / 2, 60)), Math.round(y + h / 2)])) : r(null);
});
const point = (x, y) => ac.shell.devSetPointer("w1", { x, y });
const click = (x, y) => act("mouse:down:" + x + "," + y).then(() => settle(70)).then(() => act("mouse:up:" + x + "," + y));
const clickTab = (id) => center(id).then(([x, y]) => point(x, y).then(() => click(x, y))).then(() => settle(450)).then(() => shown());
const driftTab = (id, dx, dy) => center(id).then(([x, y]) => act("drag:" + x + "," + y + ";" + (x + dx) + "," + (y + dy))).then(() => settle(1500)).then(() => [shown(), st().windows.w1.tabIds.join()]);
const pressHeld = (id, hold, flags = null) => center(id).then(([x, y]) => {
  const f = flags === null ? "" : ",1," + flags;
  return point(x, y).then(() => act("mouse:down:" + x + "," + y + f)).then(() => settle(hold)).then(() => {
    const down = shown();
    globalThis.lastDownSelection = st().selection.w1 ?? [];
    return act("mouse:up:" + x + "," + y + f).then(() => settle(450)).then(() => ({ down, up: shown() }));
  });
});
const closeButtonOf = (id) => new Promise((r) => {
  const item = [...globalThis.sidebarDrag.items.values()].find((i) => i.view && i.kind === "row" && i.tabIds.includes(id));
  item.view.measureInWindow((x, y, w, h) => r([Math.round(x + w - 17), Math.round(y + h / 2)]));
});
const clickAsCardMounts = (hoverId, clickId) => Promise.all([center(hoverId), center(clickId), win()]).then(([[hx, hy], [cx, cy], n]) =>
  point(700, 500).then(() => settle(400)).then(() => new Promise((done) => {
    const fadeMs = ac.sidebarHover.HOVER_CARD_FADE_MS;
    let stop = ac.sidebarRows.useSidebarUi.subscribe((u) => {
      if (!u.hover || !stop) return;
      stop();
      stop = null;
      const before = shown();
      if (u.hover.id !== hoverId) return done({ card: u.hover.id, before, shown: before });
      const set = Date.now();
      ac.engine.call("windows.dev", { window: n, action: "mouse:down:" + cx + "," + cy }).then((hit) => {
        const downMs = Date.now() - set;
        return settle(70).then(() => ac.engine.call("windows.dev", { window: n, action: "mouse:up:" + cx + "," + cy })).then(() => settle(450))
          .then(() => done({ card: u.hover.id, before, downMs, fading: downMs < fadeMs, hit, shown: shown() }));
      });
    });
    point(hx, hy);
    setTimeout(() => { if (stop) { stop(); stop = null; done({ card: null, before: shown(), shown: shown() }); } }, 2500);
  })));
`;
const run = (body) => app.eval(`${HELPERS}\n${body}`, { timeout: 20000 });
const press = (key, keyCode) => run(`return ac.shell.devKeyEquivalent("w1", ${JSON.stringify({ key, keyCode, modifiers: ["command"] })});`);
const clickTab = (id) => run(`return clickTab(${JSON.stringify(id)});`);

async function asCardMounts(hoverId, clickId, rounds) {
  const misses = [];
  let clicked = 0;
  for (let tries = 0; clicked < rounds && tries < rounds * 4; tries++) {
    assert.equal(await clickTab("c"), "c", "c opens before each round");
    const r = await run(`return clickAsCardMounts(${JSON.stringify(hoverId)}, ${JSON.stringify(clickId)});`);
    rep.log(`${hoverId} -> ${clickId}: ${JSON.stringify(r)}`);
    if (r.card !== hoverId || r.before === clickId || !r.fading) continue;
    clicked++;
    if (r.shown !== clickId) misses.push(r.shown);
  }
  assert.equal(clicked, rounds, `a click reached ${clickId} while ${hoverId}'s card faded in on ${clicked} of ${rounds} rounds`);
  assert.deepEqual(misses, [], `${misses.length} of ${rounds} clicks on ${clickId} did nothing`);
  return `${rounds} clicks`;
}

try {
  app = await launch(appPath, { data, port, session: fixture, onboarded: true });
  rep.log(`instance: pid ${app.pid}, DevTools port ${app.port}, data ${data}`);
  await sleep(1500);
  await run(`return act("fakeActiveClicks");`);

  await rep.check("a click whose pointer drifts up to 9 pt opens the tab or tile, and a 14 pt press is a drag that leaves the order alone", async () => {
    const order = await run("return st().windows.w1.tabIds.join();");
    for (const [id, dx, dy] of [["b", 6, 0], ["c", -9, 0], ["a", 0, 7], ["p2", 6, 2]]) {
      await run(`st().activate("pr"); return settle(600);`);
      assert.deepEqual(await run(`return driftTab(${JSON.stringify(id)}, ${dx}, ${dy});`), [id, order], `${id} drifting ${dx},${dy}`);
    }
    await run(`st().activate("pr"); return settle(600);`);
    assert.deepEqual(await run(`return driftTab("b", 14, 0);`), ["b", order], "a 14 pt press is a drag, its tab selected as the button went down");
  });

  for (const id of ["p1", "p2", "pr", "a"])
    await rep.check(`a click on ${id} in the frame its hover card appears opens it`, () => asCardMounts(id, id, 4));
  await rep.check("a click on p2 while p1's card fades in over it opens p2", () => asCardMounts("p1", "p2", 4));

  await rep.check("a press switches to the tab or tile on mouse down, before the release", async () => {
    for (const id of ["b", "p2", "pr", "c"]) {
      await run(`st().activate("a"); return settle(400);`);
      const r = await run(`return pressHeld(${JSON.stringify(id)}, 150);`);
      assert.deepEqual(r, { down: id, up: id }, `${id} pressed`);
    }
  });

  await rep.check("a drag from a press reorders the tab, which is already selected", async () => {
    await run(`st().activate("a"); return settle(400);`);
    const before = await run("return st().windows.w1.tabIds.filter((id) => !st().tabs[id].pin).join();");
    const [shownAfter, order] = await run(`return center("b").then(([x, y]) => center("c").then(([, cy]) => act("drag:" + x + "," + y + ";" + x + "," + (cy + 12)))).then(() => settle(1500)).then(() => [shown(), st().windows.w1.tabIds.filter((id) => !st().tabs[id].pin).join()]);`);
    assert.equal(shownAfter, "b", "the dragged tab is the shown one");
    assert.notEqual(order, before, "the drag moved b");
  });

  await rep.check("⌘-click and ⇧-click select without switching, on press or release", async () => {
    await run(`st().activate("a"); st().setSelection("w1", []); return settle(400);`);
    const cmd = await run(`return pressHeld("c", 120, ${1 << 20}).then((r) => ({ ...r, selection: st().selection.w1 ?? [] }));`);
    assert.deepEqual(cmd, { down: "a", up: "a", selection: ["a", "c"] }, "⌘-click");
    await run(`st().clickTab("w1", "a"); return settle(300);`);
    const shift = await run(`return pressHeld("c", 120, ${1 << 17}).then((r) => ({ ...r, selection: st().selection.w1 ?? [] }));`);
    assert.equal(shift.down, "a", "⇧-click doesn't switch on press");
    assert.equal(shift.up, "a", "⇧-click doesn't switch on release");
    assert.ok(shift.selection.includes("c") && shift.selection.includes("a"), `⇧-click selects a range (${shift.selection})`);
  });

  await rep.check("a press inside a multi-selection keeps it for a drag, and the release picks the one tab", async () => {
    await run(`st().activate("a"); st().setSelection("w1", ["a", "b", "c"]); return settle(400);`);
    const r = await run(`return pressHeld("b", 120).then((r) => ({ ...r, downSelection: globalThis.lastDownSelection, selection: st().selection.w1 ?? [] }));`);
    assert.equal(r.downSelection.length, 3, `the selection survives the press (${r.downSelection})`);
    assert.equal(r.up, "b", "the release opens the pressed tab");
    assert.deepEqual(r.selection, [], "and clears the selection");
  });

  await rep.check("a press on the shown tab changes nothing, and a double-click there renames it", async () => {
    await run(`st().activate("b"); return settle(400);`);
    const r = await run(`return pressHeld("b", 90);`);
    assert.deepEqual(r, { down: "b", up: "b" });
    const renaming = await run(`return center("b").then(([x, y]) => act("mouse:down:" + x + "," + y + ",1").then(() => act("mouse:up:" + x + "," + y + ",1")).then(() => settle(60)).then(() => act("mouse:down:" + x + "," + y + ",2")).then(() => act("mouse:up:" + x + "," + y + ",2"))).then(() => settle(400)).then(() => ac.sidebarRows.useSidebarUi.getState().renaming);`);
    assert.equal(renaming?.id, "b", "double-click renames");
    await run(`ac.sidebarRows.useSidebarUi.setState({ renaming: null }); return settle(300);`);
  });

  await rep.check("right after ⌘T, a press on a tab switches on mouse down", async () => {
    for (const id of ["b", "p1", "c"]) {
      await run(`st().activate("a"); return settle(400);`);
      await press("t", 17);
      const r = await run(`return pressHeld(${JSON.stringify(id)}, 120);`);
      assert.deepEqual(r, { down: id, up: id }, `${id} right after ⌘T`);
    }
  });

  await rep.check("after a New Tab, each tab opens on its first click", async () => {
    await clickTab("a");
    await press("t", 17);
    await sleep(600);
    for (const id of ["b", "a", "p1", "pr", "c"]) assert.equal(await clickTab(id), id, `${id} after a New Tab`);
  });

  await rep.check("a closed pinned tab opens on its first click", async () => {
    for (const id of ["p1", "pr"]) {
      assert.equal(await clickTab(id), id);
      await press("w", 13);
      await sleep(600);
      assert.notEqual(await run("return shown();"), id, `${id} closed`);
      assert.equal(await clickTab("b"), "b");
      assert.equal(await clickTab(id), id, `${id} after closing it`);
    }
  });
  await rep.check("the close button and middle-click close a tab without switching, and right-click never switches", async () => {
    await run(`st().activate("a"); return settle(400);`);
    const closed = await run(`return closeButtonOf("e").then(([x, y]) => point(x, y).then(() => settle(400)).then(() => act("mouse:down:" + x + "," + y)).then(() => settle(60)).then(() => { const down = shown(); return act("mouse:up:" + x + "," + y).then(() => settle(500)).then(() => ({ down, up: shown(), gone: !st().tabs.e })); }));`);
    assert.deepEqual(closed, { down: "a", up: "a", gone: true }, "the close button closes e without opening it");
    const middle = await run(`return center("b").then(([x, y]) => act("mouse:otherdown:" + x + "," + y).then(() => settle(60)).then(() => { const down = shown(); return act("mouse:otherup:" + x + "," + y).then(() => settle(500)).then(() => ({ down, up: shown(), gone: !st().tabs.b })); }));`);
    assert.deepEqual(middle, { down: "a", up: "a", gone: true }, "middle-click closes b without switching");
    const right = await run(`return center("p2").then(([x, y]) => act("click:" + x + "," + y + ",right")).then(() => settle(600)).then(() => shown());`);
    assert.equal(right, "a", "right-click doesn't switch");
  });
} finally {
  await app?.quit();
  server.close();
  if (!keep) rmSync(data, { recursive: true, force: true });
  else rep.say(`data: ${data}`);
}
process.exit(rep.summary() ? 0 : 1);
