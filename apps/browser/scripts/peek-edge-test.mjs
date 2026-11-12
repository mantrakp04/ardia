import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node peek-edge-test.mjs <Debug Ardia.app> [--port=<DevTools port>] [--keep-data]\n\nThe auto-hidden sidebar's peek, through the native edge watcher: a pointer resting on the window's bottom or top edge beside the peek keeps it out instead of flicking it shut and open, one that goes well past the edge closes it, an edge crossing outside the sidebar's column never opens it, once it slides away only the window's edge brings it back, and pressing the other space's dot keeps it out.");
  process.exit(2);
}
const appPath = resolve(appArg);
const port = args.find((a) => a.startsWith("--port="))?.slice(7);
const keep = args.includes("--keep-data");
const scratch = mkdtempSync(join(tmpdir(), "ac-peek-edge-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "peek-edge-test.log"), { name: "peek-edge-test" });

const WIDTH = 1280;
const HEIGHT = 800;
const fixture = session({
  profiles: ["Personal", "Work"],
  windows: [{ id: "w1", frame: [80, 80, WIDTH, HEIGHT], sidebarOpen: false }],
  tabs: [{ id: "a", url: "about:blank" }],
  settings: { sidebarWidth: 160, addressBar: "toolbar" },
});

let app = null;
const HELPERS = `
const st = () => ac.store.getState();
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const live = () => !!globalThis.acLayout.peek.w1?.live;
const at = (x, y) => ac.shell.devSetPointer("w1", { x, y }).then(() => globalThis.expo.modules.ArdiaDev.devSidebarEdgePointer("w1", x, y, true));
const watchCalls = () => { const p = globalThis.acLayout.peek.w1; const calls = []; const show = p.show, hide = p.hide;
  p.show = (...a) => (calls.push("show"), show(...a)); p.hide = (...a) => (calls.push("hide"), hide(...a));
  return () => { p.show = show; p.hide = hide; return calls; }; };
const jitter = (x, ys, ms) => { const done = watchCalls(); let i = 0;
  return new Promise((r) => { const iv = setInterval(() => at(x, ys[i++ % ys.length]), ms); setTimeout(() => { clearInterval(iv); r(); }, ms * ys.length * 4); })
    .then(() => settle(400)).then(() => ({ calls: done(), live: live() })); };
const peek = () => at(-4, 400).then(() => settle(500)).then(() => at(80, 400)).then(() => settle(300)).then(live);
const away = () => at(700, 400).then(() => settle(700)).then(live);
`;
const run = (body) => app.eval(`${HELPERS}\n${body}`);

try {
  app = await launch(appPath, { data, port, session: fixture, onboarded: true });
  await run(`if (!st().settings.autoHideTabs) st().toggleSidebar("w1"); st().updateSettings({ sidebarWidth: 160, addressBar: "toolbar" }); return settle(900);`);

  await rep.check("the left edge opens the peek and the page closes it", async () => {
    assert.equal(await run(`return peek();`), true, "opens from the left edge");
    assert.equal(await run(`return away();`), false, "closes over the page");
  });

  await rep.check("once it starts sliding away, only the window's edge brings it back, not the column it is leaving (#1192)", async () => {
    assert.equal(await run(`return peek();`), true);
    const back = await run(`return at(700, 400).then(() => settle(170)).then(() => at(80, 400)).then(() => settle(700)).then(live);`);
    assert.equal(back, false, "back into the old column mid-slide");
    assert.equal(await run(`return peek();`), true);
    const edge = await run(`return at(700, 400).then(() => settle(170)).then(() => at(2, 400)).then(() => settle(700)).then(live);`);
    assert.equal(edge, true, "the edge mid-slide");
    assert.equal(await run(`return away();`), false);
  });

  await rep.check("a pointer resting on the bottom edge beside the peek keeps it out", async () => {
    assert.equal(await run(`return peek();`), true);
    const out = await run(`return jitter(80, [${HEIGHT - 3}, ${HEIGHT + 3}, ${HEIGHT - 1}, ${HEIGHT + 6}], 160);`);
    assert.deepEqual(out.calls.filter((c) => c === "hide"), [], `no hide: ${out.calls}`);
    assert.equal(out.live, true);
  });

  await rep.check("the bottom-left corner, just past both edges, keeps it out", async () => {
    const out = await run(`return jitter(-3, [${HEIGHT + 4}, ${HEIGHT - 4}], 160);`);
    assert.deepEqual(out.calls.filter((c) => c === "hide"), [], `no hide: ${out.calls}`);
    assert.equal(out.live, true);
  });

  await rep.check("the top edge keeps it out the same way", async () => {
    const out = await run(`return at(80, 300).then(() => settle(200)).then(() => jitter(80, [2, -4], 160));`);
    assert.deepEqual(out.calls.filter((c) => c === "hide"), [], `no hide: ${out.calls}`);
    assert.equal(out.live, true);
  });

  await rep.check("going well past the bottom edge closes it, and coming back in below the left edge strip doesn't reopen it", async () => {
    assert.equal(await run(`return at(80, ${HEIGHT + 40}).then(() => settle(700)).then(live);`), false, "closed 40 pt below the window");
    assert.equal(await run(`return at(80, ${HEIGHT + 3}).then(() => settle(500)).then(live);`), false, "just below the window, beside the closed sidebar");
    assert.equal(await run(`return at(80, ${HEIGHT - 3}).then(() => settle(500)).then(live);`), false, "inside the window, past the edge strip");
  });

  await rep.check("a closed sidebar doesn't open from just below the window's bottom-left corner", async () => {
    assert.equal(await run(`return at(-3, ${HEIGHT + 4}).then(() => settle(500)).then(live);`), false);
    assert.equal(await run(`return away();`), false);
  });

  await rep.check("pressing the other space's dot switches spaces and keeps the peek out", async () => {
    assert.equal(await run(`return peek();`), true);
    const out = await run(`const before = st().windows.w1.profileId; const other = st().profileOrder.find((p) => p !== before); const done = watchCalls();
      return at(91, ${HEIGHT - 31}).then(() => ac.actions.switchProfile("w1", other, true)).then(() => settle(1200)).then(() => ({ switched: st().windows.w1.profileId === other, calls: done(), live: live() }));`);
    assert.equal(out.switched, true);
    assert.deepEqual(out.calls.filter((c) => c === "hide"), [], `no hide: ${out.calls}`);
    assert.equal(out.live, true);
  });
} finally {
  await run(`return globalThis.expo.modules.ArdiaDev.devSidebarEdgePointer("w1", 0, 0, false).then(() => ac.shell.devSetPointer("w1", null));`).catch(() => {});
  await app?.quit();
  if (!keep) rmSync(data, { recursive: true, force: true });
  else rep.say(`data: ${data}`);
}
process.exit(rep.summary() ? 0 : 1);
