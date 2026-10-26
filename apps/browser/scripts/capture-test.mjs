import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node capture-test.mjs <Debug Ardia.app> [--port=<DevTools port>] [--keep-data]\n\n⇧⌘2 (Capture…) covers the page with a crosshair, a drag copies that area of the page to the clipboard as a PNG at the screen's pixels, Esc or ⇧⌘2 again leaves without copying, and switching tabs ends it.");
  process.exit(2);
}
const appPath = resolve(appArg);
const port = args.find((a) => a.startsWith("--port="))?.slice(7);
const keep = args.includes("--keep-data");
const scratch = mkdtempSync(join(tmpdir(), "ac-capture-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "capture-test.log"), { name: "capture-test" });

const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><title>capture</title><body style="margin:0;background:#fff">
    <div style="position:absolute;left:40px;top:40px;width:200px;height:100px;background:#f00"></div>
    <div style="position:absolute;left:300px;top:40px;width:120px;height:80px;background:#00f"></div>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const pages = `http://127.0.0.1:${server.address().port}`;

const pasteboard = () =>
  JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e", `
    ObjC.import("AppKit");
    const pb = $.NSPasteboard.pasteboardWithName(${JSON.stringify(`com.ardia.scratch:${data}`)});
    const png = pb.dataForType($.NSPasteboardTypePNG);
    const out = { change: pb.changeCount, png: !png.isNil() };
    if (out.png) {
      const rep = $.NSBitmapImageRep.imageRepWithData(png);
      const px = (x, y) => { const c = rep.colorAtXY(Math.floor(x), Math.floor(y)).colorUsingColorSpace($.NSColorSpace.sRGBColorSpace);
        return [c.redComponent, c.greenComponent, c.blueComponent].map((v) => Math.round(v * 255)); };
      out.width = rep.pixelsWide; out.height = rep.pixelsHigh;
      out.left = px(2, out.height / 2); out.center = px(out.width / 2, out.height / 2); out.right = px(out.width - 3, out.height / 2);
    }
    JSON.stringify(out);`], { encoding: "utf8" }));

const red = ([r, g, b]) => r > 220 && g < 40 && b < 40;
const white = ([r, g, b]) => r > 235 && g > 235 && b > 235;

let app = null;
const HELPERS = `
const C = globalThis.expo.modules.ArdiaCEF;
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
const act = (a) => C.chromeWindows().then((ws) => C.devWindow(ws.find((w) => w.hasRoot).window, a));
const shownTab = () => { const s = ac.store.getState(), w = s.windows.w1; return w.activeTabIds[w.profileId]; };
const covered = () => act("ax").then((ax) => ax.includes("Drag to copy an area"));
const at = (kind, x, y) => ac.shell.devSetPointer("w1", { x, y }).then(() => act("mouse:" + kind + ":" + x + "," + y)).then(() => settle(40));
const drag = (x1, y1, x2, y2) => { let p = at("down", x1, y1); for (let i = 1; i <= 8; i++) p = p.then(() => at("dragged", x1 + ((x2 - x1) * i) / 8, y1 + ((y2 - y1) * i) / 8)); return p.then(() => at("up", x2, y2)); };
const press = (focus) => ac.shell.devKeyEquivalent("w1", { key: "@", keyCode: 19, modifiers: ["command", "shift"], focus, asKey: true });
`;
const run = (body) => app.eval(`${HELPERS}\n${body}`, { timeout: 20000 });

try {
  app = await launch(appPath, {
    data, port,
    session: session({
      windows: [{ id: "w1", tabIds: ["t1", "t2"], activeTabIds: { default: "t1" } }],
      tabs: [{ id: "t1", url: `${pages}/?one`, title: "one" }, { id: "t2", url: `${pages}/?two`, title: "two" }],
    }),
    onboarded: true,
    ready: "return !!ac.shell.devKeyEquivalent",
  });
  rep.log(`instance: pid ${app.pid}, DevTools port ${app.port}, data ${data}`);
  await sleep(3000);
  const frame = await run(`return act("fakeActiveClicks").then(() => settle(500)).then(() => ac.webviews.get("t1").capturePicture(0.25)).then((p) => p?.frame);`);
  assert.ok(frame, "the page's frame in the window");
  const [fx, fy] = frame;
  const dragFrom = (x1, y1, x2, y2) => run(`return drag(${fx + x1}, ${fy + y1}, ${fx + x2}, ${fy + y2}).then(() => settle(1500));`);

  await rep.check("⇧⌘2 in the page covers it with the capture crosshair", async () => {
    const r = await run(`return press("page").then(() => settle(500)).then(covered);`);
    assert.equal(r, true, "the overlay is in the window's accessibility tree");
  });

  await rep.check("a drag inside the red box copies exactly that area as a PNG", async () => {
    const before = pasteboard();
    await dragFrom(60, 60, 160, 120);
    const after = pasteboard();
    rep.log(`pasteboard ${JSON.stringify(after)}`);
    assert.notEqual(after.change, before.change, "the clipboard changed");
    assert.ok(after.png, "it holds a PNG");
    const scale = Math.round(after.width / 100);
    assert.ok((scale === 1 || scale === 2) && Math.abs(after.width - 100 * scale) <= 1, `width ${after.width} px for 100 pt`);
    assert.ok(Math.abs(after.height - 60 * scale) <= 1, `height ${after.height} px for 60 pt at ${scale}x`);
    assert.ok(red(after.center) && red(after.left) && red(after.right), `all red: ${JSON.stringify(after)}`);
    assert.equal(await run(`return covered();`), false, "the crosshair is gone");
    return `${after.width}×${after.height} px`;
  });

  await rep.check("a drag across the red box's right edge keeps both sides", async () => {
    await run(`return press("page").then(() => settle(500));`);
    await dragFrom(200, 60, 280, 100);
    const p = pasteboard();
    assert.ok(red(p.left) && white(p.right), `red then white: ${JSON.stringify(p)}`);
    return `${p.width}×${p.height} px`;
  });

  await rep.check("Esc leaves without copying", async () => {
    const before = pasteboard();
    await run(`return press("page").then(() => settle(500));`);
    assert.equal(await run(`return covered();`), true, "covered first");
    await run(`return globalThis.expo.modules.ArdiaApp.devPostKey("w1", "\\u001b", 53, []).then(() => settle(500));`);
    assert.equal(await run(`return covered();`), false, "Esc ends it");
    assert.equal(pasteboard().change, before.change, "the clipboard is untouched");
  });

  await rep.check("⇧⌘2 again and switching tabs both end it", async () => {
    const twice = await run(`return press("page").then(() => settle(400)).then(() => press("window")).then(() => settle(400)).then(covered);`);
    assert.equal(twice, false, "⇧⌘2 toggles it off");
    const switched = await run(`return press("page").then(() => settle(400)).then(() => { ac.store.getState().activate("t2"); return settle(600); }).then(covered);`);
    assert.equal(switched, false, "showing another tab ends it");
  });

  await rep.check("a click without a drag copies nothing", async () => {
    const before = pasteboard();
    await run(`return press("page").then(() => settle(500)).then(() => at("down", ${fx + 100}, ${fy + 100})).then(() => at("up", ${fx + 100}, ${fy + 100})).then(() => settle(800));`);
    assert.equal(pasteboard().change, before.change, "the clipboard is untouched");
    assert.equal(await run(`return covered();`), false, "the click ends it");
  });
} finally {
  await app?.quit();
  server.close();
  if (!keep) rmSync(data, { recursive: true, force: true });
  else rep.say(`data: ${data}`);
}
process.exit(rep.summary() ? 0 : 1);
