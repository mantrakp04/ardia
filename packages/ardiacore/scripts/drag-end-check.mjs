#!/usr/bin/env node
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { devtools, launch, sleep } from "../../../scripts/lib/instance.mjs";

const usage = `usage: drag-end-check.mjs <Debug Ardia.app> [scratch dir]
Checks, in one hidden instance launched with --test nativeDragRefused, that a page keeps taking clicks and keys after
a drag nobody ends: one a DevTools session took and left behind (dropped mid-drag, with and without
Input.setInterceptDrags), one DevTools input started that no session took, and one macOS refused to start.
No macOS drag session is ever begun: the last check runs only once the engine reports that it refuses them.`;
const [appArg, scratchArg] = process.argv.slice(2);
if (!appArg || appArg === "-h" || appArg === "--help") {
  console.log(usage);
  process.exit(appArg ? 0 : 64);
}
const scratch = resolve(scratchArg ?? join(process.env.TMPDIR ?? "/tmp", `ac-drag-end-check-${process.pid}`));
rmSync(scratch, { recursive: true, force: true });

const PAGE = `<!doctype html><title>Drag end check</title>
<style>body{margin:0;height:4000px}#drag{position:absolute;left:40px;top:40px;width:200px;height:60px;background:#48f}#pad{position:absolute;left:40px;top:200px;width:400px;height:200px;background:#eee}</style>
<div id="drag" draggable="true">drag me</div><div id="pad">pad</div>
<script>
window.counts = { mousedown: 0, mouseup: 0, keydown: 0, dragstart: 0, dragend: 0 };
window.lastPress = null;
for (const name of Object.keys(counts)) addEventListener(name, () => { counts[name]++; }, true);
addEventListener("mousedown", (e) => { lastPress = [e.clientX, e.clientY]; }, true);
drag.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", "x"));
</script>`;
const server = createServer((req, res) => res.setHeader("content-type", "text/html").end(PAGE));
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const pageUrl = `http://127.0.0.1:${server.address().port}/drag-end-check`;

let failed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const until = async (what, fn, ms = 10000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) {
    const v = await fn().catch(() => null);
    if (v) return v;
  }
  throw new Error(`timed out waiting for ${what}`);
};

const app = await launch(appArg, { data: join(scratch, "data"), js: process.env.JS ?? "pinned", onboarded: true, test: { nativeDragRefused: 1 } });
try {
  const browser = await app.browser();
  await browser.send("Target.createTarget", { url: pageUrl });
  const target = await until("the page", async () => (await app.targets()).find((t) => t.type === "page" && t.url === pageUrl));
  const session = () => devtools(target);
  const evaluate = async (s, expression) => (await s.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
  const mouse = (s, type, x, y, buttons = 1) =>
    s.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : buttons, clickCount: 1 });
  const status = () => app.eval(`return ac.engine.call("engine.cliControlStatus")`);
  const ended = async () => (await status()).dragsEnded ?? {};
  const watcher = await session();
  await until("the page visible", () => evaluate(watcher, "document.visibilityState === 'visible' && !!window.counts"));
  const counts = () => evaluate(watcher, "({ ...counts })");

  const takesInput = async () => {
    const s = await session();
    try {
      const before = await counts();
      await mouse(s, "mousePressed", 200, 300);
      await mouse(s, "mouseReleased", 200, 300);
      await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
      await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 });
      const after = await until("the click and the key", async () => {
        const now = await counts();
        return now.mousedown > before.mousedown && now.keydown > before.keydown ? now : null;
      }, 2500).catch(() => counts());
      return { ok: after.mousedown > before.mousedown && after.keydown > before.keydown, detail: `mousedown +${after.mousedown - before.mousedown}, keydown +${after.keydown - before.keydown}` };
    } finally {
      s.close();
    }
  };
  const dragStarts = async (from) => until("dragstart", async () => ((await counts()).dragstart > from ? true : null), 3000).then(() => true, () => false);

  const control = await takesInput();
  check("the page takes a click and a key to begin with", control.ok, control.detail);
  const support = await status();
  check("this engine counts the drags it ends", !!support.dragsEnded, JSON.stringify(support.dragsEnded ?? null));

  for (const intercept of [false, true]) {
    const label = intercept ? "handed over with Input.setInterceptDrags" : "taken by Chrome's DevTools drag emulation";
    const before = { ...(await ended()), ...(await counts()) };
    const driver = await session();
    if (intercept) await driver.send("Input.setInterceptDrags", { enabled: true });
    await mouse(driver, "mousePressed", 100, 70);
    for (const [x, y] of [[104, 74], [120, 90], [160, 200], [200, 300]]) await mouse(driver, "mouseMoved", x, y).catch(() => null);
    const started = await dragStarts(before.dragstart);
    driver.close();
    const released = await until("the drag ended", async () => ((await ended()).ownerGone > (before.ownerGone ?? 0) ? true : null), 3000).then(() => true, () => false);
    const input = await takesInput();
    const after = await counts();
    check(`a drag ${label}, whose session then went away, is ended and the page takes input again`,
      started && released && input.ok && after.dragend > before.dragend, `dragstart ${started}, ended by the engine ${released}, dragend +${after.dragend - before.dragend}, ${input.detail}`);
  }

  {
    const before = { ...(await ended()), ...(await counts()) };
    const presser = await session();
    await mouse(presser, "mousePressed", 100, 70);
    presser.close();
    await sleep(300);
    const mover = await session();
    for (const [x, y] of [[104, 74], [120, 90], [160, 200], [200, 300]]) await mouse(mover, "mouseMoved", x, y).catch(() => null);
    const started = await dragStarts(before.dragstart);
    const unowned = await until("the drag ended", async () => ((await ended()).debuggerUnowned > (before.debuggerUnowned ?? 0) ? true : null), 3000).then(() => true, () => false);
    await mouse(mover, "mouseReleased", 200, 300).catch(() => null);
    mover.close();
    const input = await takesInput();
    check("a drag DevTools input started that no session took never becomes a macOS drag, and the page takes input again",
      started && unowned && input.ok, `dragstart ${started}, ended by the engine ${unowned}, ${input.detail}`);
  }

  const refuses = (await status()).nativeDragsRefused === true;
  check("the engine reports that it refuses macOS drag sessions (--test nativeDragRefused)", refuses);
  if (refuses) {
    const windowNumber = await app.eval(`return ac.engine.call("windows.list").then((ws) => (ws.find((w) => w.hasRoot) ?? ws[0]).window)`);
    const act = (action) => app.eval(`return ac.engine.call("windows.dev", { window: ${windowNumber}, action: ${JSON.stringify(action)} })`);
    const size = await evaluate(watcher, "[innerWidth, innerHeight]");
    await evaluate(watcher, "lastPress = null");
    const frame = await app.eval(`return ac.engine.call("windows.list").then((ws) => (ws.find((w) => w.hasRoot) ?? ws[0]).frame)`);
    const [, , width, height] = String(frame).match(/-?[\d.]+/g).map(Number);
    const probe = [Math.round(width - size[0] / 2), Math.round(height - size[1] / 4)];
    await act(`click:${probe[0]},${probe[1]}`);
    const seen = await until("a harness click on the page", () => evaluate(watcher, "lastPress"), 4000);
    const dx = probe[0] - seen[0], dy = probe[1] - seen[1];
    const before = { ...(await ended()), ...(await counts()) };
    await act(`drag:${100 + dx},${70 + dy};${200 + dx},${300 + dy}`);
    const started = await dragStarts(before.dragstart);
    const refused = await until("the drag ended", async () => ((await ended()).nativeRefused > (before.nativeRefused ?? 0) ? true : null), 4000).then(() => true, () => false);
    await sleep(600);
    const input = await takesInput();
    check("a person's drag that macOS drag rules refuse to start is ended, and the page takes input again",
      started && refused && input.ok, `dragstart ${started}, ended by the engine ${refused}, ${input.detail}`);
  }
  watcher.close();
} catch (e) {
  check("ran to the end", false, e.message);
} finally {
  await app.quit().catch(() => app.kill());
  server.close();
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
