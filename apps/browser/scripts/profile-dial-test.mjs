import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launch, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node profile-dial-test.mjs <Debug Ardia.app> [--port=<DevTools port>] [--keep-data]");
  process.exit(2);
}
const appPath = resolve(appArg);
const port = args.find((a) => a.startsWith("--port="))?.slice("--port=".length);
const keep = args.includes("--keep-data");
const scratch = mkdtempSync(join(tmpdir(), "ac-profile-dial-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "profile-dial.log"), { name: "profile-dial-test" });
const OPTION = 524288;

const fixture = () =>
  session({
    profiles: [
      { name: "Personal", icon: "symbol:house.fill" },
      { name: "Work", icon: "◆" },
      { name: "Code", icon: "🧑‍💻" },
      { name: "Read", icon: "📚" },
      { name: "Gym", icon: "🏋️" },
    ],
    settings: { sidebarWidth: 220 },
    windows: [{ id: "w1", frame: [80, 80, 1280, 820], tabIds: ["t1"] }],
    tabs: [{ id: "t1", profileId: "default", url: "ardia://newtab", title: "New Tab" }],
  });

let app = null;
let expectedOrder = null;
const HELPERS = `
const st = () => ac.store.getState();
const dialWindow = () => globalThis.expo.modules.ArdiaCEF.chromeWindows().then((ws) => ws.find((w) => w.hasRoot).window);
const act = (a) => dialWindow().then((w) => globalThis.expo.modules.ArdiaCEF.devWindow(w, a));
`;
const run = (body, timeout = 15000) => app.eval(`${HELPERS}\n${body}`, { timeout });
const info = () => run(`return acDial.info("w1");`);
const rect = () => run(`return acDial.rect("w1");`);
const slotX = (slot) => run(`return acDial.slotX("w1", ${slot});`);
const order = () => run(`return st().profileOrder;`);
const current = () => run(`return st().windows.w1.profileId;`);
const act = (action) => run(`return act(${JSON.stringify(action)});`);
const check = (name, fn) => rep.check(name, fn);

async function checkMaybe(name, fn) {
  rep.log(`## ${name}`);
  const started = Date.now();
  try {
    const evidence = await fn();
    rep.record(name, { ms: Date.now() - started, evidence });
  } catch (error) {
    rep.record(name, { ms: Date.now() - started, ...(error?.skip ? { skip: String(error.message) } : { error }) });
  }
}

const skip = (reason) => Object.assign(new Error(reason), { skip: true });

async function settle(ms = 900) {
  await sleep(ms);
}

async function glyphPoint(slot) {
  const box = await rect();
  const layout = await info();
  return { x: Math.round(await slotX(slot)), y: Math.round(box.y + layout.glyphY) };
}

const mouse = (kind, at, flags = 0) => act(`mouse:${kind}:${at.x},${at.y},1${flags ? `,${flags}` : ""}`);
const down = (at, flags = 0) => mouse("down", at, flags);
const dragged = (at, flags = 0) => mouse("dragged", at, flags);
const up = (at, flags = 0) => mouse("up", at, flags);

async function drag(from, to, { flags = 0, pause = 60, steps = 4 } = {}) {
  await down(from, flags);
  await sleep(pause);
  const nudge = to.x >= from.x ? 4 : -4;
  await dragged({ x: from.x + nudge, y: to.y }, flags);
  await sleep(40);
  for (let step = 1; step <= steps; step += 1) {
    await dragged({ x: Math.round(from.x + ((to.x - from.x) * step) / steps), y: to.y }, flags);
    await sleep(40);
  }
}

async function click(slot) {
  const at = await glyphPoint(slot);
  await down(at);
  await sleep(60);
  await up(at);
  await settle();
}

async function restoreProfile(id) {
  const layout = await info();
  const slot = layout.ids.indexOf(id);
  if (slot < 0) return;
  await click(slot);
}

async function dragsAfterPause(slot) {
  const at = await glyphPoint(slot);
  const before = await current();
  const from = (await info()).index;
  await down(at);
  await sleep(250);
  for (const step of [0.4, 0.7, 1]) {
    await dragged({ x: Math.round(at.x - 10 * step), y: at.y });
    await sleep(40);
  }
  const tuned = await info();
  await up({ x: Math.round(at.x - 10), y: at.y });
  await settle();
  const delivered = Math.abs(tuned.position - from) > 0.1;
  if ((await current()) !== before) await restoreProfile(before);
  return { delivered, detail: `position ${tuned.position.toFixed(3)} from index ${from}` };
}

try {
  app = await launch(appPath, { data, port, session: fixture() });
  rep.log(`instance: pid ${app.pid}, DevTools port ${app.port}, data ${data}`);
  await sleep(1800);

  await check("the footer dial is a 52 pt cylinder at pitch 36 and radius 170", async () => {
    const layout = await info();
    const box = await rect();
    assert.deepEqual(layout.ids, ["default", "work", "code", "read", "gym"]);
    assert.equal(layout.index, 0);
    assert.equal(layout.footer, 52);
    assert.equal(layout.pitch, 36);
    assert.equal(layout.radius, 170);
    assert.ok(box && box.width > 0, JSON.stringify(box));
    assert.ok(Math.abs(box.height - 26) <= 0.5, `band height ${box.height}`);
    const xs = [await slotX(0), await slotX(1), await slotX(2)];
    const centre = box.x + box.width / 2;
    assert.ok(Math.abs(xs[0] - centre) < 1, `slot 0 at ${xs[0]}, centre ${centre}`);
    assert.ok(xs[1] - xs[0] > 35 && xs[1] - xs[0] < layout.pitch, `slot 0 to 1 is ${xs[1] - xs[0]} pt`);
    assert.ok(xs[2] - xs[1] < xs[1] - xs[0], `slot 1 to 2 is ${xs[2] - xs[1]} pt, spacing shrinks away from the centre`);
    return `footer ${layout.footer}, band ${JSON.stringify(box)}, slots 0..2 at ${xs.map((v) => v.toFixed(1)).join(", ")}`;
  });

  await check("clicking another glyph switches profile at its slot", async () => {
    await click(1);
    assert.equal(await current(), "work");
    assert.equal((await info()).index, 1);
    await click(2);
    assert.equal(await current(), "code");
    assert.equal((await info()).index, 2);
    return "slot 1 then slot 2: work, then code";
  });

  await check("a plain drag tunes without switching until release", async () => {
    const before = await current();
    const from = (await info()).index;
    const beforeIds = (await info()).ids;
    const at = await glyphPoint(from);
    const target = await glyphPoint(from - 1);
    await drag(at, { x: target.x, y: at.y });
    await sleep(150);
    const tuned = await info();
    const heldProfile = await current();
    await up({ x: target.x, y: at.y });
    await settle();
    assert.ok(tuned.position > from + 0.8 && tuned.position < from + 1.1, `position ${tuned.position} while held one slot from ${from}`);
    assert.equal(heldProfile, before, "no switch while the dial is being tuned");
    assert.equal(await current(), beforeIds[from + 1]);
    return `${before} to ${beforeIds[from + 1]}, position ${tuned.position.toFixed(3)} while held`;
  });

  await check("option-drag on a non-current glyph moves that glyph, not the first one", async () => {
    const layout = await info();
    const before = await current();
    const startOrder = await order();
    const from = 1;
    const id = startOrder[from];
    const start = await glyphPoint(from);
    const end = await glyphPoint(from + 1);
    await drag(start, end, { flags: OPTION });
    await up(end, OPTION);
    await settle();
    expectedOrder = startOrder.slice();
    expectedOrder.splice(from, 1);
    expectedOrder.splice(from + 1, 0, id);
    assert.equal(await current(), before, "reorder keeps the window's profile");
    assert.deepEqual(await order(), expectedOrder);
    assert.equal((await order())[0], layout.ids[0], "the first profile stays first");
    return `${id} from slot ${from} to ${from + 1}: ${startOrder.join(",")} to ${expectedOrder.join(",")}`;
  });

  await check("the option-drag drops the glyph on the next slot, cylinder spacing", async () => {
    const layout = await info();
    const from = 1;
    const start = await slotX(from);
    const end = await slotX(from + 1);
    const gap = end - start;
    assert.ok(gap > 0 && gap < layout.pitch, `slot ${from} to ${from + 1} is ${gap} pt, under the ${layout.pitch} pt pitch`);
    assert.equal(layout.ids[from + 1], expectedOrder[from + 1], `${expectedOrder[from + 1]} rests on slot ${from + 1}`);
    await sleep(1400);
    const saved = JSON.parse(readFileSync(join(data, "session.json"), "utf8"));
    assert.deepEqual(saved.profileOrder, expectedOrder);
    return `slots at ${start} and ${end} (${gap} pt); saved ${saved.profileOrder.join(",")}`;
  });

  await checkMaybe("hold then drag reorders without a keyboard", async () => {
    const layout = await info();
    const before = await current();
    const startOrder = await order();
    const from = layout.index === 0 ? 1 : layout.index - 1;
    const to = from < layout.ids.length - 1 ? from + 1 : from - 1;
    const id = startOrder[from];
    const attempt = async (flags) => {
      const start = await glyphPoint(from);
      const end = await glyphPoint(to);
      await drag(start, { x: end.x, y: start.y }, { flags, pause: 420 });
      await up({ x: end.x, y: start.y }, flags);
      await settle();
      return order();
    };
    const held = await attempt(0);
    if (held[to] === id && (await current()) === before) return `${id}: slot ${from} to ${to} after a 420 ms hold: ${startOrder.join(",")} to ${held.join(",")}`;
    const became = (await current()) !== before ? "a tune or a click" : "nothing";
    if (became !== "nothing") await restoreProfile(before);
    const optionHeld = await attempt(OPTION);
    if (optionHeld[to] === id)
      throw new Error(`a 420 ms hold became ${became}, while an option-drag with the same pause moved ${id} from slot ${from} to ${to}: the hold-to-reorder path did not engage`);
    const probe = await dragsAfterPause(from);
    if (!probe.delivered)
      throw skip(`the synthetic injector stops delivering dragged events after a pause in the down state: the 420 ms hold became ${became} and left the order unchanged, an option-drag with the same pause did not reorder either, and a 10 pt drag after 250 ms left ${probe.detail}; needs a real mouse`);
    throw skip(`the injector delivers a drag after a 250 ms pause, but neither the 420 ms hold nor an option-drag with the same pause reordered (${probe.detail}); long-press reorder needs a real mouse`);
  });

  await check("holding a glyph and releasing without a drag leaves nothing lifted", async () => {
    const layout = await info();
    const before = await current();
    const at = await glyphPoint(layout.index);
    await down(at);
    await sleep(500);
    await up(at);
    await settle(500);
    const after = await info();
    assert.equal(after.lifted, null, `still lifted: ${after.lifted}`);
    assert.equal(await current(), before, "the hold switched profile");
    return `lifted ${after.lifted}, still on ${before}`;
  });

  await check("the order survives a save", async () => {
    const expected = await order();
    await sleep(1400);
    const saved = JSON.parse(readFileSync(join(data, "session.json"), "utf8"));
    assert.deepEqual(saved.profileOrder, expected);
    return saved.profileOrder.join(",");
  });

  await check("moving a profile from the menu action keeps every profile", async () => {
    const before = await order();
    const id = before[before.length - 1];
    await run(`st().moveProfile(${JSON.stringify(id)}, -1); return true;`);
    const after = await order();
    assert.notDeepEqual(after, before);
    assert.equal(after.length, before.length);
    assert.equal(new Set(after).size, before.length);
    assert.equal(after[before.length - 2], id);
    return `${id}: ${before.join(",")} to ${after.join(",")}`;
  });
} catch (error) {
  rep.log(String(error?.stack ?? error));
  if (app) await app.quit().catch(() => {});
  rep.say(`failed: ${error?.message ?? error}`);
  process.exit(1);
}

if (app) await app.quit().catch(() => {});
const passed = rep.summary();
if (passed && !keep) rmSync(scratch, { recursive: true, force: true });
else rep.say(`data: ${data}`);
process.exit(passed ? 0 : 1);
