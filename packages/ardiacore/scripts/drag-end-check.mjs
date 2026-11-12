#!/usr/bin/env node
import { rmSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { devtools, launch, sleep } from "../../../scripts/lib/instance.mjs";

const usage = `usage: drag-end-check.mjs <Debug Ardia.app> [scratch dir]
Checks, in one hidden instance launched with --test nativeDragRefused, that a page keeps taking clicks and keys after
a drag nobody ends: one a DevTools session took and left behind (dropped mid-drag, with and without
Input.setInterceptDrags), one DevTools input started that no session took, and one macOS refused to start. Also: a
DevTools drag between a page and a cross-site iframe ends in the frame it started in, a session that only holds a
press never owns another session's drag, a late answer for a finished drag (a cancelled drag's move, a drop whose
session went away) touches nothing, a drag that entered a frame leaves it when it is cancelled or abandoned, a drag
whose source frame was destroyed ends no other widget's drag, a drop whose destination frame is destroyed or whose
drag ended during its widget lookup gets an error and frees the page, a mouse drag that Input.dispatchDragEvent
also took into a frame leaves it, and a navigation during a drag's first update doesn't crash the browser.
No macOS drag session is ever begun: the last check runs only once the engine reports that it refuses them.`;
const [appArg, scratchArg] = process.argv.slice(2);
if (!appArg || appArg === "-h" || appArg === "--help") {
  console.log(usage);
  process.exit(appArg ? 0 : 64);
}
const scratch = resolve(scratchArg ?? join(process.env.TMPDIR ?? "/tmp", `ac-drag-end-check-${process.pid}`));
rmSync(scratch, { recursive: true, force: true });

const PAGE = `<!doctype html><title>Drag end check</title>
<style>body{margin:0;height:4000px}#drag{position:absolute;left:40px;top:40px;width:200px;height:60px;background:#48f}#pad{position:absolute;left:40px;top:200px;width:400px;height:160px;background:#eee}#frame{position:absolute;left:40px;top:400px;width:400px;height:200px;border:0}</style>
<div id="drag" draggable="true">drag me</div><div id="pad">pad</div>FRAME
<script>
window.counts = { mousedown: 0, mouseup: 0, keydown: 0, dragstart: 0, dragend: 0 };
window.frameCounts = { mousedown: 0, dragstart: 0, dragend: 0, dragenter: 0, dragleave: 0, drop: 0 };
window.lastPress = null;
for (const name of Object.keys(counts)) addEventListener(name, () => { counts[name]++; }, true);
addEventListener("mousedown", (e) => { lastPress = [e.clientX, e.clientY]; }, true);
window.lastOver = null;
addEventListener("dragover", (e) => { lastOver = [e.clientX, e.clientY]; }, true);
addEventListener("message", (e) => { if (e.data in frameCounts) frameCounts[e.data]++; });
const busyMs = Number(new URLSearchParams(location.search).get("busy"));
drag.addEventListener("dragstart", (e) => {
  e.dataTransfer.setData("text/plain", "x");
  if (busyMs) setTimeout(() => { for (const end = performance.now() + busyMs; performance.now() < end; ); }, 0);
});
</script>`;
const FRAME = `<!doctype html><title>Drag end check frame</title>
<style>body{margin:0;background:#dfd}#inner{position:absolute;left:10px;top:10px;width:150px;height:40px;background:#f84}</style>
<div id="inner" draggable="true">drag me too</div>
<script>
for (const name of ["mousedown", "dragstart", "dragend", "dragenter", "dragleave", "drop"]) addEventListener(name, () => parent.postMessage(name, "*"), true);
addEventListener("dragover", (e) => e.preventDefault());
let busyOnEnter = 0;
addEventListener("message", (e) => {
  busyOnEnter = Number(e.data.busyOnEnter || 0);
  for (const end = performance.now() + Number(e.data.busy || 0); performance.now() < end; );
});
addEventListener("dragenter", () => {
  const ms = busyOnEnter;
  busyOnEnter = 0;
  for (const end = performance.now() + ms; performance.now() < end; );
});
inner.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", "y"));
</script>`;
const PAGE2 = `<!doctype html><title>Drag end check</title>
<style>body{margin:0;height:4000px}#drag{position:absolute;left:40px;top:40px;width:200px;height:60px;background:#48f}#pad{position:absolute;left:40px;top:200px;width:400px;height:160px;background:#eee}
#frame{position:absolute;left:40px;top:400px;width:400px;height:200px;border:0}#slow{position:absolute;left:480px;top:400px;width:300px;height:200px;border:0;clip-path:circle(45%);border-radius:40px}</style>
<div id="drag" draggable="true">drag me</div><div id="pad">pad</div>
<iframe id="frame" src="http://localhost:PORT/frame2?name=frame"></iframe><iframe id="slow" src="http://localhost:PORT/frame2?name=slow"></iframe>
<script>
window.counts = { mousedown: 0, mouseup: 0, keydown: 0, dragstart: 0, dragend: 0 };
window.frames2 = { frame: {}, slow: {} };
for (const name of Object.keys(counts)) addEventListener(name, () => { counts[name]++; }, true);
addEventListener("message", (e) => { const f = frames2[e.data.from]; if (f) f[e.data.name] = (f[e.data.name] || 0) + 1; });
drag.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", "x"));
window.spin = (ms) => setTimeout(() => { for (const end = performance.now() + ms; performance.now() < end; ); }, 0);
</script>`;
const FRAME2 = `<!doctype html><title>frame</title>
<style>body{margin:0;background:#dfd}#inner{position:absolute;left:10px;top:10px;width:150px;height:40px;background:#f84}</style>
<div id="inner" draggable="true">drag me too</div>
<script>
const from = new URLSearchParams(location.search).get("name");
for (const name of ["mousedown", "dragstart", "dragend", "dragenter", "dragleave", "drop"]) addEventListener(name, () => parent.postMessage({ from, name }, "*"), true);
addEventListener("dragover", (e) => e.preventDefault());
addEventListener("message", (e) => { for (const end = performance.now() + Number(e.data.busy || 0); performance.now() < end; ); });
inner.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", "y"));
</script>`;
const server = createServer((req, res) => {
  const port = server.address().port;
  const path = new URL(req.url, "http://x").pathname;
  res.setHeader("content-type", "text/html");
  if (path === "/frame") return res.end(FRAME);
  if (path === "/frame2") return res.end(FRAME2);
  if (path === "/second") return res.end(PAGE2.replaceAll("PORT", String(port)));
  if (path === "/other") return res.end(PAGE.replace("FRAME", ""));
  res.end(PAGE.replace("FRAME", `<iframe id="frame" src="http://localhost:${port}/frame"></iframe>`));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const pageUrl = `http://127.0.0.1:${server.address().port}/drag-end-check`;
const pageUrl2 = `http://127.0.0.1:${server.address().port}/second`;
const otherSiteUrl = `http://localhost:${server.address().port}/other`;

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

  {
    const frames = () => evaluate(watcher, "({ ...frameCounts })");
    const settled = async (read, key, from) => until(key, async () => ((await read())[key] > from ? true : null), 3000).then(() => true, () => false);
    await until("the cross-site frame", async () => (await app.targets()).some((t) => t.type === "iframe" && t.url.includes("/frame")));
    let before = { ...(await counts()), ended: await ended() };
    let driver = await session();
    await mouse(driver, "mousePressed", 100, 70);
    for (const [x, y] of [[104, 74], [120, 90], [160, 300], [240, 520]]) await mouse(driver, "mouseMoved", x, y).catch(() => null);
    const startedInPage = await dragStarts(before.dragstart);
    await mouse(driver, "mouseReleased", 240, 520).catch(() => null);
    const endedInPage = await settled(counts, "dragend", before.dragend);
    let input = await takesInput();
    check("a DevTools drag from the page dropped on a cross-site frame ends in the page, which takes input again",
      startedInPage && endedInPage && input.ok, `dragstart ${startedInPage}, dragend in the page ${endedInPage}, ${input.detail}`);
    driver.close();
    await sleep(300);

    const frameBefore = await frames();
    driver = await session();
    await mouse(driver, "mousePressed", 90, 430);
    for (const [x, y] of [[94, 434], [110, 440], [160, 380], [200, 300]]) await mouse(driver, "mouseMoved", x, y).catch(() => null);
    const startedInFrame = await settled(frames, "dragstart", frameBefore.dragstart);
    await mouse(driver, "mouseReleased", 200, 300).catch(() => null);
    const endedInFrame = await settled(frames, "dragend", frameBefore.dragend);
    const pressesBefore = (await frames()).mousedown;
    await mouse(driver, "mousePressed", 340, 550).catch(() => null);
    await mouse(driver, "mouseReleased", 340, 550).catch(() => null);
    const frameTakesInput = await settled(frames, "mousedown", pressesBefore);
    check("a DevTools drag from a cross-site frame dropped on the page ends in the frame, which takes input again",
      startedInFrame && endedInFrame && frameTakesInput, `dragstart ${startedInFrame}, dragend in the frame ${endedInFrame}, frame mousedown ${frameTakesInput}`);
    driver.close();
    await sleep(300);
    input = await takesInput();
    check("the page still takes input after both", input.ok, input.detail);

    for (const finish of ["drop", "dragCancel"]) {
      before = { ...(await counts()), ended: await ended() };
      driver = await session();
      let handed = null;
      driver.on("Input.dragIntercepted", (event) => { handed = event.data; });
      await driver.send("Input.setInterceptDrags", { enabled: true });
      await mouse(driver, "mousePressed", 100, 70);
      for (const [x, y] of [[104, 74], [120, 90], [160, 200]]) await mouse(driver, "mouseMoved", x, y).catch(() => null);
      const data = await until("the drag handed over", async () => handed, 3000).catch(() => null);
      if (data) {
        const at = { x: 240, y: 520, data };
        if (finish === "drop") await driver.send("Input.dispatchDragEvent", { type: "dragEnter", ...at }).catch(() => null);
        await driver.send("Input.dispatchDragEvent", { type: finish, ...at }).catch(() => null);
      }
      await mouse(driver, "mouseReleased", 240, 520).catch(() => null);
      const endedInPage = await settled(counts, "dragend", before.dragend);
      await driver.send("Input.setInterceptDrags", { enabled: false });
      const afterEnded = await ended();
      input = await takesInput();
      check(`a handed-over drag from the page finished with Input.dispatchDragEvent ${finish} over a cross-site frame ends in the page`,
        !!data && endedInPage && input.ok && (afterEnded.ownerGone ?? 0) === (before.ended.ownerGone ?? 0),
        `handed over ${!!data}, dragend in the page ${endedInPage}, ended as abandoned +${(afterEnded.ownerGone ?? 0) - (before.ended.ownerGone ?? 0)}, ${input.detail}`);
      driver.close();
      await sleep(300);
    }

    const busyFrame = (ms) => evaluate(watcher, `document.getElementById("frame").contentWindow.postMessage({ busy: ${ms} }, "*")`).then(() => sleep(150));
    const pressAndDrag = async (s, points) => {
      await mouse(s, "mousePressed", 100, 70);
      for (const [x, y] of points) await mouse(s, "mouseMoved", x, y).catch(() => null);
    };

    {
      const frameBefore = await frames();
      driver = await session();
      await pressAndDrag(driver, [[104, 74], [120, 90], [160, 200]]);
      await evaluate(watcher, `document.getElementById("frame").contentWindow.postMessage({ busyOnEnter: 2500 }, "*")`);
      await sleep(150);
      const woke = Date.now() + 2500;
      const lateMove = mouse(driver, "mouseMoved", 240, 520).then(() => ({ how: "answered", early: woke - Date.now() }), () => ({ how: "refused", early: woke - Date.now() }));
      await sleep(200);
      await driver.send("Input.cancelDragging").catch(() => null);
      await mouse(driver, "mouseReleased", 200, 300).catch(() => null);
      before = await counts();
      await pressAndDrag(driver, [[104, 74], [120, 90], [160, 200]]);
      const second = await dragStarts(before.dragstart);
      await sleep(300);
      const overBefore = await evaluate(watcher, "lastOver");
      await sleep(Math.max(0, woke - Date.now()) + 1200);
      const entered = (await frames()).dragenter - frameBefore.dragenter;
      const heldEnds = (await counts()).dragend - before.dragend;
      const over = await evaluate(watcher, "lastOver");
      const stayed = !!over && !!overBefore && over[0] === overBefore[0] && over[1] === overBefore[1];
      await mouse(driver, "mouseReleased", 200, 300).catch(() => null);
      const finished = await settled(counts, "dragend", before.dragend);
      const late = await lateMove;
      check("a cancelled drag's unanswered move is refused, not replayed as a mouse event into the drag started after it",
        second && late.how === "refused" && entered <= 1 && stayed && heldEnds === 0 && finished,
        `second drag started ${second}, it was over ${overBefore} before the late update and ${over} after, frame dragenter +${entered}, dragend while held +${heldEnds}, the cancelled drag's move was ${late.how} once the frame answered, dragend at the release ${finished}`);
      driver.close();
      await sleep(300);
    }

    {
      before = { ...(await counts()), frame: await frames() };
      driver = await session();
      let handed = null;
      driver.on("Input.dragIntercepted", (event) => { handed = event.data; });
      await driver.send("Input.setInterceptDrags", { enabled: true });
      await pressAndDrag(driver, [[104, 74], [120, 90], [160, 200]]);
      const data = await until("the drag handed over", async () => handed, 3000).catch(() => null);
      await busyFrame(2500);
      const woke = Date.now() + 2500;
      if (data) void driver.send("Input.dispatchDragEvent", { type: "drop", x: 240, y: 520, data }, { timeout: 8000 }).catch(() => null);
      await sleep(300);
      driver.close();
      const abandoned = await settled(counts, "dragend", before.dragend);
      const next = await session();
      const held = await counts();
      await pressAndDrag(next, [[104, 74], [120, 90], [160, 200]]);
      const second = await dragStarts(held.dragstart);
      await sleep(Math.max(0, woke - Date.now()) + 1200);
      const heldEnds = (await counts()).dragend - held.dragend;
      const lateDrops = (await frames()).drop - before.frame.drop;
      await mouse(next, "mouseReleased", 200, 300).catch(() => null);
      const finished = await settled(counts, "dragend", held.dragend);
      next.close();
      check("a drop whose session went away before the destination answered is not delivered, and doesn't end the next drag",
        !!data && abandoned && second && heldEnds === 0 && lateDrops === 0 && finished,
        `handed over ${!!data}, ended at the detach ${abandoned}, second drag started ${second}, dragend while held +${heldEnds}, late drops in the frame +${lateDrops}, dragend at the release ${finished}`);
      await sleep(300);
    }

    for (const finish of ["dragCancel", "detach"]) {
      before = { ...(await counts()), frame: await frames() };
      driver = await session();
      let handed = null;
      driver.on("Input.dragIntercepted", (event) => { handed = event.data; });
      await driver.send("Input.setInterceptDrags", { enabled: true });
      await pressAndDrag(driver, [[104, 74], [120, 90], [160, 200]]);
      const data = await until("the drag handed over", async () => handed, 3000).catch(() => null);
      if (data) await driver.send("Input.dispatchDragEvent", { type: "dragEnter", x: 240, y: 520, data }).catch(() => null);
      const enteredFrame = await settled(frames, "dragenter", before.frame.dragenter);
      if (finish === "dragCancel") {
        if (data) await driver.send("Input.dispatchDragEvent", { type: "dragCancel", x: 240, y: 520, data }).catch(() => null);
        await mouse(driver, "mouseReleased", 240, 520).catch(() => null);
        await driver.send("Input.setInterceptDrags", { enabled: false });
      }
      driver.close();
      const left = await settled(frames, "dragleave", before.frame.dragleave);
      const endedInPage = await settled(counts, "dragend", before.dragend);
      check(`a handed-over drag that entered a cross-site frame and ended with ${finish === "detach" ? "its session going away" : "Input.dispatchDragEvent dragCancel"} leaves the frame`,
        !!data && enteredFrame && left && endedInPage, `handed over ${!!data}, dragenter in the frame ${enteredFrame}, dragleave in the frame ${left}, dragend in the page ${endedInPage}`);
      await sleep(300);
    }

    {
      const frameBefore = await frames();
      const endedBefore = await ended();
      driver = await session();
      await mouse(driver, "mousePressed", 90, 430);
      for (const [x, y] of [[94, 434], [110, 440], [160, 380], [200, 300]]) await mouse(driver, "mouseMoved", x, y).catch(() => null);
      const started = await settled(frames, "dragstart", frameBefore.dragstart);
      await evaluate(watcher, `document.getElementById("frame").remove()`);
      await until("the frame gone", async () => !(await app.targets()).some((t) => t.type === "iframe" && t.url.includes("/frame")), 5000).catch(() => null);
      const released = await mouse(driver, "mouseReleased", 200, 300).then(() => "answered", (e) => `failed (${e.message.slice(0, 60)})`);
      await sleep(400);
      const sourceGone = ((await ended()).sourceGone ?? 0) - (endedBefore.sourceGone ?? 0);
      driver.close();
      input = await takesInput();
      check("a drag whose source frame was destroyed finishes without telling another widget its drag ended",
        started && sourceGone === 1 && input.ok, `dragstart in the frame ${started}, the release ${released}, finished without a source +${sourceGone}, ${input.detail}`);
    }
  }

  {
    const holder = await session();
    await mouse(holder, "mousePressed", 300, 320);
    await mouse(holder, "mouseMoved", 310, 326);
    const before = { ...(await counts()), ended: await ended() };
    const dragger = await session();
    await mouse(dragger, "mousePressed", 100, 70);
    for (const [x, y] of [[104, 74], [120, 90], [160, 200], [200, 300]]) await mouse(dragger, "mouseMoved", x, y).catch(() => null);
    const started = await dragStarts(before.dragstart);
    holder.close();
    await sleep(700);
    const during = { ...(await counts()), ended: await ended() };
    const untouched = during.dragend === before.dragend && (during.ended.ownerGone ?? 0) === (before.ended.ownerGone ?? 0);
    await mouse(dragger, "mouseReleased", 200, 300).catch(() => null);
    const finished = await until("dragend", async () => ((await counts()).dragend > before.dragend ? true : null), 3000).then(() => true, () => false);
    dragger.close();
    const input = await takesInput();
    check("a session that only holds a press doesn't own another session's drag: closing it leaves that drag alone",
      started && untouched && finished && input.ok,
      `dragstart ${started}, dragend while held +${during.dragend - before.dragend}, ended by the engine +${(during.ended.ownerGone ?? 0) - (before.ended.ownerGone ?? 0)}, dragend at the release ${finished}, ${input.detail}`);
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

  {
    const DATA = { items: [{ mimeType: "text/plain", data: "x" }], dragOperationsMask: 1 };
    const open = async () => {
      const { targetId } = await browser.send("Target.createTarget", { url: pageUrl2 });
      const target = await until("the page", async () => (await app.targets()).find((t) => t.id === targetId));
      await until("both frames", async () => (await app.targets()).filter((t) => t.type === "iframe" && t.url.includes("/frame2")).length >= 2);
      const watcher = await devtools(target);
      const evaluate = async (expression) => (await watcher.send("Runtime.evaluate", { expression, returnByValue: true }, { timeout: 15000 })).result.value;
      await until("the page visible", () => evaluate("document.visibilityState === 'visible' && !!window.counts"));
      await sleep(800);
      return {
        targetId, target, watcher, evaluate, session: () => devtools(target),
        counts: () => evaluate("({ ...counts })"),
        frames: () => evaluate("JSON.parse(JSON.stringify(frames2))"),
      };
    };
    const mouse = (s, type, x, y, timeout = 10000) =>
      s.send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 }, { timeout });
    const takesInput = async (page) => {
      const s = await page.session();
      try {
        const before = await page.counts();
        await mouse(s, "mousePressed", 200, 300).catch(() => null);
        await mouse(s, "mouseReleased", 200, 300).catch(() => null);
        await s.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 }).catch(() => null);
        await s.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65 }).catch(() => null);
        const after = await until("input", async () => { const now = await page.counts(); return now.mousedown > before.mousedown && now.keydown > before.keydown ? now : null; }, 2500).catch(() => page.counts());
        return { ok: after.mousedown > before.mousedown && after.keydown > before.keydown, detail: `mousedown +${after.mousedown - before.mousedown}, keydown +${after.keydown - before.keydown}` };
      } finally { s.close(); }
    };
    const handOver = async (page) => {
      const driver = await page.session();
      let handed = null;
      driver.on("Input.dragIntercepted", (event) => { handed = event.data; });
      await driver.send("Input.setInterceptDrags", { enabled: true });
      await mouse(driver, "mousePressed", 100, 70);
      for (const [x, y] of [[104, 74], [120, 90], [160, 200]]) await mouse(driver, "mouseMoved", x, y).catch(() => null);
      const data = await until("the drag handed over", async () => handed, 3000).catch(() => null);
      return { driver, data };
    };
    const answer = (promise) => { const at = Date.now(); return promise.then(() => ({ how: "answered", ms: Date.now() - at }), (e) => ({ how: /cdp timeout/.test(e.message) ? "never answered" : "refused", ms: Date.now() - at })); };
    const of = (frames, name, key) => frames[name]?.[key] ?? 0;

    {
      const page = await open();
      const before = await page.counts();
      const { driver, data } = await handOver(page);
      await page.evaluate(`document.getElementById("frame").contentWindow.postMessage({ busy: 3000 }, "*")`);
      await sleep(150);
      const drop = answer(driver.send("Input.dispatchDragEvent", { type: "drop", x: 240, y: 520, data }, { timeout: 7000 }));
      await sleep(300);
      await page.evaluate(`document.getElementById("frame").remove()`);
      const dropped = await drop;
      const ended = (await page.counts()).dragend - before.dragend;
      const input = await takesInput(page);
      check("a drop whose destination frame is destroyed before it answers gets an error, and the page it came from takes input again",
        !!data && dropped.how === "refused" && ended === 1 && input.ok, `handed over ${!!data}, the drop was ${dropped.how} after ${dropped.ms} ms, dragend in the page +${ended}, ${input.detail} (session still attached)`);
      driver.close();
    }

    {
      const page = await open();
      const before = await page.counts();
      const { driver, data } = await handOver(page);
      const dropped = await answer(driver.send("Input.dispatchDragEvent", { type: "drop", x: 99999, y: 99999, data }, { timeout: 7000 }));
      await sleep(500);
      const ended = (await page.counts()).dragend - before.dragend;
      const input = await takesInput(page);
      check("a drop at a point with no widget ends the drag it belonged to, and the page takes input again",
        !!data && dropped.how !== "never answered" && input.ok, `handed over ${!!data}, the drop was ${dropped.how} after ${dropped.ms} ms, dragend in the page +${ended}, ${input.detail} (session still attached)`);
      driver.close();
    }

    {
      const page = await open();
      const { driver, data } = await handOver(page);
      const probe = await page.session();
      await page.evaluate("spin(1500)");
      await sleep(100);
      const stalled = await answer(probe.send("Input.dispatchDragEvent", { type: "dragOver", x: 630, y: 500, data: DATA }, { timeout: 7000 }));
      const fast = await answer(probe.send("Input.dispatchDragEvent", { type: "dragOver", x: 630, y: 500, data: DATA }, { timeout: 7000 }));
      probe.close();
      const slowPath = stalled.ms > 900;
      console.log(`note  a drag event over the clipped frame while the page's renderer is busy answered after ${stalled.ms} ms (${fast.ms} ms when idle): its widget lookup ${slowPath ? "waits for the page's renderer" : "does not wait for the page's renderer"}`);
      if (slowPath) {
        const before = await page.frames();
        await page.evaluate("spin(2500)");
        await sleep(100);
        const woke = Date.now() + 2500;
        const drop = answer(driver.send("Input.dispatchDragEvent", { type: "drop", x: 630, y: 500, data }, { timeout: 9000 }));
        await sleep(200);
        await driver.send("Input.setInterceptDrags", { enabled: false }, { timeout: 9000 }).catch(() => null);
        const dropped = await drop;
        await mouse(driver, "mouseReleased", 160, 200).catch(() => null);
        const lateDrops = of(await page.frames(), "slow", "drop") - of(before, "slow", "drop");
        const input = await takesInput(page);
        check("a drop whose drag was ended while its widget lookup was waiting is refused instead of running against whatever came next",
          !!data && dropped.how === "refused" && lateDrops === 0 && input.ok, `handed over ${!!data}, the old drop was ${dropped.how} after ${dropped.ms} ms, drops in the clipped frame +${lateDrops}, ${input.detail}`);
      }
      driver.close();
    }

    {
      for (const finish of ["detach", "Input.cancelDragging"]) {
        const page = await open();
        const before = { ...(await page.counts()), frames: await page.frames() };
        const driver = await page.session();
        await mouse(driver, "mousePressed", 100, 70);
        for (const [x, y] of [[104, 74], [120, 90], [160, 200], [200, 300]]) await mouse(driver, "mouseMoved", x, y).catch(() => null);
        const started = await until("dragstart", async () => ((await page.counts()).dragstart > before.dragstart ? true : null), 3000).then(() => true, () => false);
        const entered = await answer(driver.send("Input.dispatchDragEvent", { type: "dragEnter", x: 240, y: 520, data: DATA }));
        const inFrame = await until("dragenter", async () => (of(await page.frames(), "frame", "dragenter") > of(before.frames, "frame", "dragenter") ? true : null), 3000).then(() => true, () => false);
        if (finish === "detach") driver.close();
        else await driver.send("Input.cancelDragging").catch(() => null);
        const left = await until("dragleave", async () => (of(await page.frames(), "frame", "dragleave") > of(before.frames, "frame", "dragleave") ? true : null), 3000).then(() => true, () => false);
        const input = await takesInput(page);
        check(`a mouse drag over the page that Input.dispatchDragEvent also took into a cross-site frame leaves that frame on ${finish}`,
          started && inFrame && left && input.ok, `dragstart ${started}, dragEnter ${entered.how}, dragenter in the frame ${inFrame}, dragleave in the frame ${left}, ${input.detail}`);
        driver.close();
      }
    }
  }

  {
    await browser.send("Target.createTarget", { url: `${pageUrl}?busy=3000` });
    const busy = await until("the busy page", async () => (await app.targets()).find((t) => t.type === "page" && t.url.includes("busy=3000")));
    const driver = await devtools(busy);
    await until("the busy page visible", async () => (await driver.send("Runtime.evaluate", { expression: "document.visibilityState === 'visible' && !!window.counts", returnByValue: true })).result.value);
    await sleep(1500);
    const endedBefore = (await ended()).ownerGone ?? 0;
    await mouse(driver, "mousePressed", 100, 70);
    for (const [x, y] of [[104, 74], [120, 90]]) void mouse(driver, "mouseMoved", x, y).catch(() => null);
    await sleep(500);
    void driver.send("Page.navigate", { url: otherSiteUrl }, { timeout: 15000 }).catch(() => null);
    await sleep(5000);
    const alive = app.alive;
    const answers = alive && (await status().then((s) => !!s.dragsEnded, () => false));
    check("a navigation to another site while a DevTools drag's first update is unanswered doesn't crash the browser", alive && answers,
      alive ? `the browser is running, drags it ended +${((await ended()).ownerGone ?? 0) - endedBefore}, now at ${(await app.targets()).find((t) => t.id === busy.id)?.url}` : "the browser process is gone");
    driver.close();
  }
} catch (e) {
  check("ran to the end", false, e.message);
} finally {
  await app.quit().catch(() => app.kill());
  server.close();
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
