import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node newtab-row-hover-test.mjs <Debug Ardia.app> [--port=<DevTools port>] [--trials=<n>] [--keep-data]\n\nThe sidebar's New Tab row loses its hover once the pointer leaves it: click it, open a page from the New Tab page, move the pointer off, and every row the pointer entered has heard it leave, also when the row's size changed under the pointer as the new tab slid in (GitHub issue: New Tab stays highlighted). Each trial runs with new tabs next to the current one and at the bottom.");
  process.exit(2);
}
const appPath = resolve(appArg);
const port = args.find((a) => a.startsWith("--port="))?.slice(7);
const trials = Number(args.find((a) => a.startsWith("--trials="))?.slice(9) ?? 6);
const keep = args.includes("--keep-data");
const scratch = mkdtempSync(join(tmpdir(), "ac-newtab-row-hover-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "newtab-row-hover-test.log"), { name: "newtab-row-hover-test" });

const server = createServer((req, res) => {
  const name = req.url.slice(1) || "root";
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>${name.toUpperCase()}</title><link rel="icon" href="data:,"><body style="font:40px sans-serif">${name}</body>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const url = (name) => `http://127.0.0.1:${server.address().port}/${name}`;
const fixture = session({
  windows: [{ id: "w1", frame: [80, 80, 1280, 800], activeTabIds: { default: "t0" } }],
  tabs: [{ id: "t0", url: url("t0"), title: "T0" }],
});

let app = null;
const HELPERS = `
const st = () => ac.store.getState();
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const drag = () => globalThis.sidebarDrag;
const frame = (view) => new Promise((r) => (view ? view.measureInWindow((x, y, w, h) => r({ x, y, w, h })) : r(null)));
const rowOf = (id) => [...drag().items.values()].find((i) => i.view && i.kind !== "tail" && i.tabIds.includes(id));
const newTabRow = () => { const ids = st().windows.w1.tabIds; const below = ids.map((id) => rowOf(id)).filter(Boolean); return Promise.all(below.map((i) => frame(i.view))).then((fs) => fs.reduce((a, f) => (f && (!a || f.y > a.y) ? f : a), null)).then((f) => ({ x: f.x + 40, y: f.y + f.h * 1.5 })); };
const point = (p) => ac.shell.devSetPointer("w1", p);
`;
const run = (body) => app.eval(`${HELPERS}\n${body}`, { timeout: 30000 });

async function trial(position, n) {
  return run(`
    st().updateSettings({ newTabPosition: ${JSON.stringify(position)} });
    return settle(300)
      .then(() => point({ x: 900, y: 600 }))
      .then(() => settle(300))
      .then(() => newTabRow())
      .then((row) => { ac.shell.devHoverStats(true); return point(row).then(() => settle(500)).then(() => ac.shell.devClick("w1", row)); })
      .then(() => settle(900))
      .then(() => ac.shell.devTypeKeys("key", ${JSON.stringify(url(`page-${position}-${n}`))} + "\\r", 10))
      .then(() => settle(1500))
      .then(() => point({ x: -200, y: 400 }))
      .then(() => settle(600))
      .then(() => ac.shell.devHoverStats(false))
      .then((stats) => {
        const last = new Map();
        for (const [kind, tag] of stats.log ?? []) last.set(tag, kind);
        const open = [...last].filter(([, kind]) => kind === "enter").map(([tag]) => tag);
        const active = st().windows.w1.activeTabIds.default;
        return { open, entered: (stats.log ?? []).filter((e) => e[0] === "enter").length, url: st().tabs[active]?.url ?? null };
      });
  `);
}

try {
  app = await launch(appPath, { data, port, session: fixture, onboarded: true });
  rep.log(`instance: pid ${app.pid}, DevTools port ${app.port}, data ${data}`);
  await run(`return settle(1500);`);
  for (const position of ["nextToCurrent", "bottom"]) {
    await rep.check(`New Tab row, new tabs ${position}: clicked, a page opened, the pointer gone: no row is left hovered (${trials} tries)`, async () => {
      const stuck = [];
      for (let n = 0; n < trials; n++) {
        const result = await trial(position, n);
        assert.ok(result.entered > 0, `try ${n}: the pointer never entered a row (${JSON.stringify(result)})`);
        assert.equal(result.url, url(`page-${position}-${n}`), `try ${n}: the page didn't open in the new tab`);
        if (result.open.length) stuck.push(`try ${n}: views ${result.open.join(", ")} entered and never left`);
      }
      assert.deepEqual(stuck, []);
    });
  }
} finally {
  await app?.quit();
  server.close();
  if (!keep) rmSync(data, { recursive: true, force: true });
  else rep.say(`data: ${data}`);
}
process.exit(rep.summary() ? 0 : 1);
