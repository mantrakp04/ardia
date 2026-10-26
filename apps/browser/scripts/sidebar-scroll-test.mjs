import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node sidebar-scroll-test.mjs <Debug Ardia.app> [--port=<DevTools port>] [--keep-data]\n\nThe sidebar's pinned tiles stay put while the tabs scroll under them (Dia's dock), with the address field in the sidebar and without: drags onto the tiles after a scroll, selecting a tile while scrolled, and a dock too tall for the window (24 tiles in an 800 pt window).");
  process.exit(2);
}
const appPath = resolve(appArg);
const port = args.find((a) => a.startsWith("--port="))?.slice(7);
const keep = args.includes("--keep-data");
const scratch = mkdtempSync(join(tmpdir(), "ac-sidebar-scroll-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "sidebar-scroll-test.log"), { name: "sidebar-scroll-test" });

const server = createServer((req, res) => {
  const name = req.url.slice(1) || "root";
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>${name.toUpperCase()}</title><link rel="icon" href="data:,"><body style="font:40px sans-serif">${name}</body>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = (name) => `http://127.0.0.1:${server.address().port}/${name}`;
const tab = (id, extra = {}) => ({ id, url: url(id), title: id.toUpperCase(), ...extra });
const PINS = ["p1", "p2", "p3"];
const LOOSE = Array.from({ length: 40 }, (_, i) => `t${i}`);
const fixture = session({
  windows: [{ id: "w1", frame: [80, 80, 1280, 800], activeTabIds: { default: "t0" } }],
  tabs: [...PINS.map((id) => tab(id, { pinned: true, pinnedUrl: url(id) })), ...LOOSE.map((id) => tab(id))],
});

let app = null;
const HELPERS = `
const st = () => ac.store.getState();
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const win = () => ac.engine.call("windows.list").then((ws) => ws.find((w) => w.hasRoot).window);
const act = (a) => win().then((n) => ac.engine.call("windows.dev", { window: n, action: a }));
const drag = () => globalThis.sidebarDrag;
const frame = (view) => new Promise((r) => (view ? view.measureInWindow((x, y, w, h) => r({ x, y, w, h })) : r(null)));
const itemOf = (id) => [...drag().items.values()].find((i) => i.view && i.kind !== "tail" && i.tabIds.includes(id));
const frameOf = (id) => frame(itemOf(id) && itemOf(id).view);
const scrollTo = (y) => { drag().scroll.scrollTo({ y, animated: false }); return settle(400).then(() => drag().scrollY); };
const tiles = () => st().windows.w1.tabIds.filter((id) => st().tabs[id].pinned && !st().tabs[id].pinnedAsRow);
const viewport = () => frame(drag().scroll);
`;
const run = (body) => app.eval(`${HELPERS}\n${body}`, { timeout: 30000 });

async function layoutWith(addressBar) {
  await run(`st().updateSettings({ addressBar: ${JSON.stringify(addressBar)}, tabLayout: "sidebar" }); return settle(900).then(() => scrollTo(0));`);
}

async function rowInView(min = 0) {
  return run(`return viewport().then((v) => Promise.all(${JSON.stringify(LOOSE)}.map((id) => frameOf(id).then((f) => f && { id, ...f }))).then((fs) =>
    fs.filter((f) => f && !st().tabs[f.id].pinned && f.y >= v.y + 20 && f.y + f.h <= v.y + v.h - 20 && f.y >= ${min})[2]));`);
}

async function dragRowOntoTile(addressBar) {
  await layoutWith(addressBar);
  await run(`st().pinTabs(tiles().filter((id) => !${JSON.stringify(PINS)}.includes(id)), false); return settle(600);`);
  const at0 = await run(`return frameOf("p2");`);
  const scrolled = await run(`return scrollTo(260);`);
  assert.ok(scrolled > 200, `the list scrolled (${scrolled})`);
  const tile = await run(`return frameOf("p2");`);
  assert.deepEqual([tile.x, tile.y], [at0.x, at0.y], "the tiles hold still while the tabs scroll");
  const row = await rowInView();
  assert.ok(row, "a row in view after the scroll");
  const sx = Math.round(row.x + 40), sy = Math.round(row.y + row.h / 2);
  const tx = Math.round(tile.x + 6), ty = Math.round(tile.y + tile.h / 2);
  const steps = [[sx, sy], [sx + 6, sy - 10], [sx + 10, sy - 40], [tx, Math.round((sy + ty) / 2)], [tx, ty + 6], [tx, ty + 2], [tx, ty]];
  await run(`return act("drag:${steps.map((p) => p.join(",")).join(";")}").then(() => settle(1500));`);
  const after = await run(`return tiles();`);
  assert.ok(after.includes(row.id), `${row.id} dragged from the scrolled list onto p2 is pinned (tiles ${after.join(",")})`);
  assert.equal(after.indexOf(row.id), after.indexOf("p2") - 1, `it lands before p2, where it was let go (tiles ${after.join(",")})`);
  await run(`st().placeTabs([${JSON.stringify(row.id)}], { pinned: false, beforeId: null }); return settle(600);`);
  return `${row.id} pinned before p2 after a ${scrolled} pt scroll`;
}

try {
  app = await launch(appPath, { data, port, session: fixture, onboarded: true });
  rep.log(`instance: pid ${app.pid}, DevTools port ${app.port}, data ${data}`);
  await sleep(1500);
  await run(`return act("fakeActiveClicks");`);

  for (const addressBar of ["sidebar", "toolbar"])
    await rep.check(`${addressBar === "sidebar" ? "address field in the sidebar" : "Dia's layout"}: after a scroll, a row dragged onto a tile pins it there (a new tile row opens)`, () =>
      dragRowOntoTile(addressBar));

  await rep.check("selecting a pinned tile while the list is scrolled leaves the list where it is", async () => {
    await layoutWith("sidebar");
    const scrolled = await run(`return scrollTo(260);`);
    const after = await run(`st().activate("p3"); return settle(900).then(() => drag().scrollY);`);
    const shown = await run(`return st().windows.w1.activeTabIds[st().windows.w1.profileId];`);
    if (shown !== "p3") {
      const tile = await run(`return frameOf("p3");`);
      const x = Math.round(tile.x + tile.w / 2), y = Math.round(tile.y + tile.h / 2);
      await run(`return ac.shell.devSetPointer("w1", { x: ${x}, y: ${y} }).then(() => act("mouse:down:${x},${y}")).then(() => settle(70)).then(() => act("mouse:up:${x},${y}")).then(() => settle(900));`);
    }
    assert.equal(await run(`return st().windows.w1.activeTabIds[st().windows.w1.profileId];`), "p3", "p3 selected");
    assert.equal(await run(`return drag().scrollY;`), scrolled, `the list stays at ${scrolled} (was ${after})`);
    await run(`return ac.shell.devSetPointer("w1", null);`);
  });

  await rep.check("twenty rows dragged onto three tiles: the dock's preview stops at its share of the sidebar, the list keeps its room, and all twenty pin", async () => {
    await layoutWith("sidebar");
    const many = LOOSE.slice(1, 21);
    await run(`st().setSelection("w1", ${JSON.stringify(many)}); return settle(300);`);
    const row = await run(`return frameOf("t3");`);
    const tile = await run(`return frameOf("p2");`);
    const room = (await run(`return viewport();`)).h;
    const sx = Math.round(row.x + 40), sy = Math.round(row.y + row.h / 2);
    const tx = Math.round(tile.x + 6), ty = Math.round(tile.y + tile.h / 2);
    const steps = [[sx, sy], [sx + 6, sy - 10], [sx + 10, sy - 40], [tx, Math.round((sy + ty) / 2)], [tx, ty + 6], [tx, ty + 2], [tx, ty], [tx, ty]];
    const during = await run(`const seen = []; const iv = setInterval(() => viewport().then((v) => seen.push(v && v.h)), 80);
      return act("drag:${steps.map((p) => p.join(",")).join(";")}").then(() => settle(3000)).then(() => { clearInterval(iv); return seen; });`);
    const after = await run(`return tiles();`);
    assert.equal(after.length, 23, `all twenty pinned (tiles ${after.join(",")})`);
    for (const id of many) assert.ok(after.includes(id), `${id} pinned`);
    assert.ok(Math.min(...during.filter(Boolean)) > room * 0.6, `the list kept its room through the drag (${Math.min(...during.filter(Boolean))} of ${room} pt)`);
    const top = await run(`return scrollTo(0).then(() => frameOf("p1"));`);
    const moved = await run(`return scrollTo(120).then(() => frameOf("p1"));`);
    assert.ok(moved.y < top.y - 100, `23 tiles scroll with the tabs (${top.y} -> ${moved.y})`);
    await run(`st().setSelection("w1", []); st().pinTabs(${JSON.stringify(many)}, false); return settle(900).then(() => scrollTo(0));`);
  });

  await rep.check("a dock too tall for the window scrolls with the tabs, so every tile and tab stays reachable", async () => {
    await layoutWith("sidebar");
    await run(`st().pinTabs(${JSON.stringify(LOOSE.slice(1, 22))}, true); return settle(900).then(() => scrollTo(0));`);
    const count = (await run(`return tiles();`)).length;
    assert.equal(count, 24, "24 tiles");
    const top = await run(`return frameOf("p1");`);
    await run(`return scrollTo(120);`);
    const moved = await run(`return frameOf("p1");`);
    assert.ok(moved.y < top.y - 100, `the tiles scroll with the tabs (${top.y} -> ${moved.y})`);
    await run(`st().pinTabs(${JSON.stringify(LOOSE.slice(1, 22))}, false); return settle(900).then(() => scrollTo(0));`);
    const back = await run(`return frameOf("p1");`);
    await run(`return scrollTo(120);`);
    const fixed = await run(`return frameOf("p1");`);
    assert.equal(fixed.y, back.y, "three tiles stay put again");
  });
} finally {
  await app?.quit();
  server.close();
  if (!keep) rmSync(data, { recursive: true, force: true });
  else rep.say(`data: ${data}`);
}
process.exit(rep.summary() ? 0 : 1);
