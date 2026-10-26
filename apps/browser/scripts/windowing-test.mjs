import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { launch, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node windowing-test.mjs <Debug Ardia.app> [--port=<DevTools port>] [--keep-data]");
  process.exit(2);
}
const appPath = resolve(appArg);
const port = args.find((a) => a.startsWith("--port="))?.slice(7);
const keep = args.includes("--keep-data");
const scratch = mkdtempSync(join(tmpdir(), "ac-windowing-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "windowing-test.log"), { name: "windowing-test" });

const page = (bg, ink, title) => `<!doctype html><title>${title}</title><body style="margin:0;background:${bg};color:${ink};font:22px Georgia">
  <h1 style="font:900 110px/1 Helvetica;text-align:center;margin:40px 0">${title.toUpperCase()}</h1>
  ${Array.from({ length: 60 }, (_, i) => `<p style="margin:0 40px 18px">Paragraph ${i}: members who stop answering are noticed again.</p>`).join("")}</body>`;
const server = createServer((req, res) => {
  const blue = req.url.startsWith("/blue");
  res.writeHead(200, { "content-type": "text/html" });
  res.end(blue ? page("#1d3557", "#f1faee", "Blue post") : page("#ece6da", "#141210", "Official gazette"));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const tab = (id, windowId, url, createdAt) => ({ id, windowId, url, title: url ? id : "", createdAt, lastActiveAt: createdAt });
const fixture = () => session({
  profiles: [{ id: "default", name: "Personal", color: "plum" }],
  settings: { tabLayout: "sidebar" },
  windows: [
    { id: "w1", tabIds: ["n1", "g1", "b1", "n2"], activeTabIds: { default: "g1" }, frame: [40, 222, 1000, 700] },
    { id: "w2", tabIds: ["m1"], activeTabIds: { default: "m1" }, frame: [1060, 332, 440, 500] },
  ],
  focusedWindowId: "w2",
  tabs: [tab("n1", "w1", "", 1), tab("g1", "w1", `${base}/gazette`, 2), tab("b1", "w1", `${base}/blue`, 3), tab("n2", "w1", "", 4), tab("m1", "w2", `${base}/blue?moved`, 5)],
});

let app = null;
const HELPERS = `
const st = () => ac.store.getState();
const win = (id) => ac.engine.call("windows.list").then((ws) => { const f = st().windows[id].frame; const w = ws.filter((w) => w.hasRoot).find((w) => { const r = w.frame.match(/[-\\d.]+/g).map(Number); return Math.abs(r[0] - f[0]) < 2 && Math.abs(r[2] - f[2]) < 2; }); return w && w.window; });
const act = (id, a) => win(id).then((n) => ac.engine.call("windows.dev", { window: n, action: a }));
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
`;
const run = (body) => app.eval(`${HELPERS}\n${body}`);
const closeWindowsBut = (ids) =>
  run(`const keep = ${JSON.stringify(ids)}; Object.keys(st().windows).filter((id) => !keep.includes(id)).forEach((id) => st().closeWindow(id)); return settle(500);`);

const recorderSource = join(dirname(fileURLToPath(import.meta.url)), "windowing-rec.swift");
const recorder = join(data, "windowing-rec");
let noScreen = null;

const screenLocked = () =>
  /<key>CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(spawnSync("ioreg", ["-n", "Root", "-d1", "-a"], { encoding: "utf8", timeout: 5000 }).stdout ?? "");

const ENTRANCE_FRAMES = 20;

async function record(seconds, during) {
  const file = join(data, `frames-${Date.now()}.jsonl`);
  const child = spawn(recorder, [String(app.pid), String(seconds), file], { stdio: ["ignore", "pipe", "pipe"] });
  let said = "";
  child.stdout.on("data", (d) => (said += d));
  child.stderr.on("data", (d) => rep.log(`recorder: ${String(d).trim()}`));
  const done = new Promise((r) => child.on("exit", r));
  for (const start = Date.now(); !said.includes("started") && Date.now() - start < 8000; await sleep(20)) if (child.exitCode !== null) break;
  if (!said.includes("started")) {
    child.kill("SIGKILL");
    return null;
  }
  await sleep(300);
  await during();
  const ended = await Promise.race([done, sleep((seconds + 10) * 1000).then(() => "timeout")]);
  if (ended === "timeout") child.kill("SIGKILL");
  if (!existsSync(file)) return null;
  const frames = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
    const f = JSON.parse(l);
    return { t: f.t, w: f.w, h: f.h, g: Buffer.from(f.g, "base64") };
  });
  return frames.length > 10 ? frames : null;
}

const regionOf = (frame, H, inset = { left: 0, top: 0, right: 0, bottom: 0 }) => ({
  x: Math.round((frame[0] + inset.left) / 8),
  y: Math.round((H - frame[1] - frame[3] + inset.top) / 8),
  w: Math.round((frame[2] - inset.left - inset.right) / 8),
  h: Math.round((frame[3] - inset.top - inset.bottom) / 8),
});
const crop = (f, r) => {
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) out[y * r.w + x] = f.g[(r.y + y) * f.w + r.x + x] ?? 0;
  return out;
};
const diff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (c) => { const m = mean(c); return Math.sqrt(c.reduce((s, v) => s + (v - m) ** 2, 0) / c.length); };

function glitches(frames, r, tolerance = 4) {
  const crops = frames.map((f) => crop(f, r));
  const runs = [];
  for (let i = 0; i < crops.length; i++) {
    if (runs.length && diff(crops[i], crops[runs.at(-1).at]) < 1) runs.at(-1).n++;
    else runs.push({ at: i, n: 1 });
  }
  const resting = runs.filter((run) => run.n >= 3).map((run) => crops[run.at]);
  const found = runs.filter((run) => run.n < 3 && resting.every((s) => diff(crops[run.at], s) > tolerance));
  return Object.assign(found.map((run) => ({ t: frames[run.at].t, frames: run.n })), { crops: [...resting, ...found.map((run) => crops[run.at])] });
}

function dump(name, crops, r) {
  const shown = crops.slice(0, 48);
  const width = shown.length * (r.w + 1);
  const out = Buffer.alloc(width * r.h, 255);
  shown.forEach((c, i) => { for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) out[y * width + i * (r.w + 1) + x] = c[y * r.w + x]; });
  const file = join(scratch, `windowing-${name}.pgm`);
  writeFileSync(file, Buffer.concat([Buffer.from(`P5 ${width} ${r.h} 255\n`), out]));
  rep.log(`frames judged: ${file}`);
}

function readPng(path) {
  const buf = readFileSync(path);
  let width = 0, height = 0, channels = 4;
  const idat = [];
  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at), type = buf.toString("ascii", at + 4, at + 8);
    if (type === "IHDR") {
      width = buf.readUInt32BE(at + 8);
      height = buf.readUInt32BE(at + 12);
      assert.equal(buf[at + 16], 8, "8-bit");
      channels = { 2: 3, 6: 4 }[buf[at + 17]];
    } else if (type === "IDAT") idat.push(buf.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? out[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      out[y * stride + x] = (v + pred) & 255;
    }
  }
  return { width, height, channels, data: out };
}
function snapshotGrey(path, [x0, y0, x1, y1]) {
  const png = readPng(path);
  const r = { w: Math.round((x1 - x0) / 8), h: Math.round((y1 - y0) / 8) };
  const out = new Uint8Array(r.w * r.h);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const i = ((y0 + y * 8 + 4) * 2 * png.width + (x0 + x * 8 + 4) * 2) * png.channels;
      out[y * r.w + x] = Math.round(0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2]);
    }
  return Object.assign(out, { r });
}

async function newWindowInProcess(ids) {
  const shots = [join(data, "new-window-shown.png"), join(data, "new-window-settled.png")];
  const shown = await run(`
    let before, t0, id, at = null;
    const poll = () => ac.engine.call("windows.list").then((ws) => {
      const w = ws.find((w) => !before.has(w.window));
      if (w && w.alpha === 1) { at = Date.now() - t0; return ac.shell.devSnapshotWindow(id, ${JSON.stringify(shots[0])}); }
      return Date.now() - t0 > 3000 ? false : poll();
    });
    return ac.engine.call("windows.list").then((ws) => { before = new Set(ws.map((w) => w.window)); t0 = Date.now(); return ac.actions.openWindow(); })
      .then((created) => { id = created; return poll(); })
      .then((saved) => saved && settle(1500).then(() => ac.shell.devSnapshotWindow(id, ${JSON.stringify(shots[1])})))
      .then((saved) => ({ id, at, saved, frame: st().windows[id] && st().windows[id].frame }));`);
  assert.ok(shown.id && !ids.includes(shown.id), "a new window");
  assert.ok(shown.at !== null, "the window never turned opaque");
  assert.ok(shown.saved, "devSnapshotWindow failed");
  const box = [8, 40, 180, shown.frame[3] - 40];
  const [first, settled] = shots.map((path) => snapshotGrey(path, box));
  const off = diff(first, settled);
  rep.log(`opaque ${shown.at} ms after openWindow; its sidebar then ${off.toFixed(1)} levels from settled (in-process snapshots)`);
  if (off >= 6) dump("new-window", [first, settled], first.r);
  assert.ok(off < 6, `opaque ${shown.at} ms after opening, its sidebar ${off.toFixed(1)} levels from the settled window`);
}

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const skip = await fn();
    rep.record(name, { ms: Date.now() - t0, skip: skip || undefined });
  } catch (error) {
    rep.record(name, { ms: Date.now() - t0, error });
  }
}

try {
  mkdirSync(data, { recursive: true });
  const built = spawnSync("swiftc", ["-O", recorderSource, "-o", recorder], { encoding: "utf8" });
  if (built.status !== 0) rep.log(`(no recorder: ${built.stderr.trim().split("\n")[0]})`);
  app = await launch(appPath, { data, port, session: fixture(), onboarded: true, probe: true });
  rep.log(`instance: pid ${app.pid}, DevTools port ${app.port}, data ${data}`);
  await sleep(2500);
  let probe = null;
  if (!existsSync(recorder)) noScreen = "no frame recorder (swiftc failed)";
  else if (screenLocked()) noScreen = "needs unlocked screen: it is locked, WindowServer records nothing";
  else if (!(probe = await record(0.5, async () => {}))) noScreen = "needs a recordable screen: the recorder got no frames (display asleep?)";
  const H = probe ? probe[0].h * 8 : 0;
  if (noScreen) rep.log(`(frames can't be recorded: ${noScreen})`);

  await check("tab switches show the old page or the new one, never a blank or half-drawn page", async () => {
    if (noScreen) return noScreen;
    const frame = await run(`return st().windows.w1.frame;`);
    await run(`ac.actions.switchToTab("b1"); return settle(1500).then(() => { ac.actions.switchToTab("g1"); return settle(1000); });`);
    const order = ["b1", "g1", "n2", "b1", "n1", "g1", "b1", "n2", "g1", "b1", "g1", "n1", "b1", "g1", "n2", "b1", "n2", "g1", "b1", "g1"];
    const frames = await record(9.5, () => run(`${JSON.stringify(order)}.forEach((id, i) => setTimeout(() => ac.actions.switchToTab(id), i * 400)); return 1;`));
    assert.ok(frames, "no frames");
    const region = regionOf(frame, H, { left: 200, top: 56, right: 16, bottom: 16 });
    const found = glitches(frames, region);
    if (found.length > 4) dump("tab-switches", found.crops, region);
    assert.ok(found.length <= 4, `${found.length} frames match neither tab: ${JSON.stringify(found)}`);
  });

  await check("a new window shows up with its content", async () => {
    const ids = await run(`return Object.keys(st().windows);`);
    try {
      if (noScreen) return await newWindowInProcess(ids);
      let frames;
      let created;
      frames = await record(2.5, async () => { created = await run(`return ac.actions.openWindow();`); });
      assert.ok(frames && created && !ids.includes(created), "a new window");
      const frame = await run(`return st().windows["${created}"].frame;`);
      const r = regionOf(frame, H, { left: 8, top: 40, right: frame[2] - 180, bottom: 40 });
      const crops = frames.map((f) => crop(f, r));
      const first = crops.findIndex((c, i) => i > 0 && diff(c, crops[0]) > 4);
      assert.ok(first > 0, "the window never showed");
      const entrance = crops.slice(first, first + ENTRANCE_FRAMES).map((c) => diff(c, crops.at(-1)));
      const settled = entrance.findIndex((d) => d < 1);
      const backwards = entrance.findIndex((d, i) => i > 0 && d > entrance[i - 1] + 1.5);
      if (settled < 0 || backwards > 0) {
        rep.log(`frame ${first} of ${crops.length} first differs (${diff(crops[first], crops[0]).toFixed(1)} from the one before the window); then ${entrance.map((d) => d.toFixed(1)).join(", ")} from the settled one`);
        dump("new-window", [crops[0], ...crops.slice(Math.max(1, first - 2), first + ENTRANCE_FRAMES), crops.at(-1)], r);
      }
      assert.ok(settled >= 0, `still ${entrance.at(-1)?.toFixed(1)} levels from the settled window ${ENTRANCE_FRAMES} frames after it showed`);
      assert.ok(backwards < 0, `frame ${backwards} of the entrance moved away from the settled window (a blank or half-drawn frame)`);
    } finally {
      await closeWindowsBut(ids);
    }
  });

  await check("a tab torn off into a new window: its old window shows its next tab soon", async () => {
    if (noScreen) return noScreen;
    const w1 = await run(`return st().windows.w1.frame;`);
    await run(`ac.actions.switchToTab("b1"); return settle(500);`);
    let row = null;
    for (let y = 40; y <= 320 && row === null; y += 12) {
      await run(`return act("w1", "click:60,${y}").then(() => settle(250));`);
      if ((await run(`return st().windows.w1.activeTabIds.default;`)) === "g1") row = y;
    }
    assert.ok(row !== null, "g1's row in w1's tab list");
    await run(`ac.actions.switchToTab("b1"); return settle(800).then(() => { ac.actions.switchToTab("g1"); return settle(1200); });`);
    const ids = await run(`return Object.keys(st().windows);`);
    const target = [w1[2] + 300, w1[3] - 50];
    const path = `60,${row};60,${row + 20};${w1[2] - 100},${row + 60};${target.join(",")};${target[0] + 2},${target[1] + 2};${target.join(",")}`;
    let frames, torn;
    try {
      frames = await record(5, () => run(`return act("w1", "drag:${path}").then(() => settle(${6 * 12 * 16 + 1500}));`));
      torn = (await run(`return Object.values(st().windows).map((w) => [w.id, w.tabIds]);`)).find(([id]) => !ids.includes(id));
    } finally {
      await closeWindowsBut(ids);
    }
    assert.ok(torn && torn[1].includes("g1"), "g1 in a new window");
    assert.ok(frames, "no frames");
    const page = regionOf(w1, H, { left: 200, top: 56, right: 16, bottom: 16 });
    const crops = frames.map((f) => crop(f, page));
    const blank = crops.filter((c) => sd(c) < 3);
    rep.log(`${blank.length} frames of w1's page blank`);
    if (blank.length > 5) dump("tear-off", crops.filter((c, i) => crops.slice(Math.max(0, i - 1), i + 2).some((n) => sd(n) < 3)), page);
    assert.ok(blank.length <= 5, `${blank.length} frames of w1's page blank`);
  });

  let drop = null;
  await check("a window's last tab dropped onto another window: the tab keeps its live page", async () => {
    const strips = () => run(`return ac.engine.call("tabs.strips").then((tx) => tx.strips.flatMap((s) => s.tabs).filter((t) => t.key === "m1").map((t) => t.browser));`);
    const [browser] = await strips();
    assert.ok(browser, "m1 is live");
    const w2 = await run(`return st().windows.w2.frame;`);
    const w1 = await run(`return st().windows.w1.frame;`);
    const target = [w1[0] + 110 - w2[0], (w2[1] + w2[3]) - (w1[1] + w1[3] - 160)];
    const path = `70,70;70,100;-300,150;${target[0] + 30},${target[1]};${target.join(",")};${target[0] + 2},${target[1] + 2};${target.join(",")}`;
    const go = () => run(`return act("w2", "drag:${path}").then(() => settle(${7 * 12 * 16 + 1200}));`);
    const frames = noScreen ? (await go(), null) : await record(4.5, go);
    drop = { frames, w1, w2 };
    const after = await run(`return Object.values(st().windows).map((w) => [w.id, w.tabIds]);`);
    assert.deepEqual(after.find(([id]) => id === "w2"), undefined, `w2 closed: ${JSON.stringify(after)}`);
    assert.ok(after.find(([id]) => id === "w1")[1].includes("m1"), `m1 in w1: ${JSON.stringify(after)}`);
    await sleep(800);
    assert.deepEqual(await strips(), [browser], "the same live tab, not a new one");
  });

  await check("a window's last tab dropped onto another window: the emptied window goes at once, the page shows at once", async () => {
    if (noScreen) return noScreen;
    assert.ok(drop?.frames, "no frames of the drop");
    const { frames, w1, w2 } = drop;
    const r = regionOf(w2, H, { left: 8, top: 8, right: 8, bottom: 8 });
    const crops = frames.map((f) => crop(f, r));
    const gone = crops.findIndex((c) => mean(c) <= 3);
    assert.ok(gone > 0, "w2 went");
    let held = gone - 1;
    while (held >= 2 && !(diff(crops[held], crops[held - 1]) <= 4 && diff(crops[held], crops[held - 2]) <= 4)) held--;
    const was = crops[held];
    const between = crops.filter((c, i) => i > held && diff(c, was) > 4 && mean(c) > 3);
    if (between.length > 1) {
      rep.log(`w2's place, frame by frame (levels from w2 as it was at the drop, mean): ${crops.map((c) => `${diff(c, was).toFixed(0)}/${mean(c).toFixed(0)}`).join(" ")}`);
      dump("emptied-window", [was, ...between], r);
    }
    assert.ok(between.length <= 1, `${between.length} frames of w2 neither as it was nor gone`);
    const page = regionOf(w1, H, { left: 200, top: 56, right: 16, bottom: 16 });
    const pages = frames.map((f) => crop(f, page));
    const blank = pages.filter((c) => sd(c) < 3);
    if (blank.length > 1) dump("dropped-page", pages.filter((c, i) => pages.slice(Math.max(0, i - 1), i + 2).some((n) => sd(n) < 3)), page);
    assert.ok(blank.length <= 1, `${blank.length} frames of w1's page blank`);
  });
} finally {
  await app?.quit();
  server.close();
  if (!keep) rmSync(data, { recursive: true, force: true });
  else rep.say(`data: ${data}`);
}
process.exit(rep.summary() ? 0 : 1);
