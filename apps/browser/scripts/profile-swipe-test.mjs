import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { launch, listenerPids, parsePort, reporter, session, sleep } from "../../../scripts/lib/instance.mjs";

const args = process.argv.slice(2);
if (args.includes("--self-test")) {
  const module = fileURLToPath(new URL("../../../scripts/lib/instance.mjs", import.meta.url));
  process.exit(spawnSync(process.execPath, [module, "--self-test"], { stdio: "inherit" }).status ?? 1);
}
const appArg = args.find((a) => !a.startsWith("--"));
if (!appArg) {
  console.error("usage: node profile-swipe-test.mjs <Debug Ardia.app> [--port=<DevTools port>] [--keep-data] [--stale-window] [--only=<case name substring>] [--bundle-port=<Metro port>] | --self-test");
  process.exit(2);
}
const app = resolve(appArg);
const bundlePort = args.find((a) => a.startsWith("--bundle-port="))?.split("=")[1];
if (bundlePort) assert.match(bundlePort, /^\d{2,5}$/);
const portArg = args.find((a) => a.startsWith("--port="))?.slice("--port=".length);
let port;
try { port = portArg && parsePort(portArg); } catch (error) {
  console.error(`--port: ${error.message}`);
  process.exit(2);
}
const keep = args.includes("--keep-data");
const stale = args.includes("--stale-window");
const only = args.find((a) => a.startsWith("--only="))?.slice("--only=".length).toLowerCase();
let matched = 0;
const scratch = mkdtempSync(join(tmpdir(), "ac-profile-swipe-"));
const data = join(scratch, "data");
const rep = reporter(join(scratch, "profile-swipe.log"), { name: "profile-swipe-test" });
const evidence = { app, data, stale, cases: [] };
let owned;
function ownedDeath() {
  if (!owned || !owned.exited) return null;
  evidence.death ??= { pid: owned.pid, detectedAt: new Date().toISOString(), alive: false,
    portListeners: (() => { try { return listenerPids(owned.port); } catch (e) { return String(e); } })() };
  return Object.assign(new Error(`owned app pid ${owned.pid} died`), { appDied: true });
}
function assertOwnedAlive() {
  const death = ownedDeath();
  if (death) throw death;
}
const server = createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/html" });
  if (req.url.startsWith("/history")) return res.end(`<!doctype html><title>${req.url}</title><h1>${req.url}</h1>`);
  res.end('<!doctype html><title>Swipe scroll fixture</title><body style="margin:0"><div style="width:2600px;height:4000px;background:linear-gradient(120deg,#ffd9dd,#addbff)">Native scroll fixture</div>');
});

const tab = (id, profileId) => ({ id, profileId, url: "ardia://newtab", title: "New Tab" });
const fixture = session({ profiles: ["Personal", "Work"], tabs: [tab("t1", "default"), tab("t2", "work")] });

const ac = (body, timeout = 15000) => owned.eval(body, { timeout });
const profile = () => ac('return ac.store.getState().windows.w1.profileId;');
async function waitProfile(expected) {
  for (let start = Date.now(); Date.now() - start < 1800;) {
    if (await profile() === expected) return;
    await sleep(25);
  }
  assert.equal(await profile(), expected, "profile should switch within 1.8s");
}
async function reset() {
  await ac('ac.store.getState().switchProfile("w1", "default"); return true;');
  await waitProfile("default");
  await sleep(250);
}
const windows = () => ac('return globalThis.expo.modules.ArdiaCEF.chromeWindows();');
async function nativeWindow() {
  const all = await windows();
  return all.find((w) => w.hasRoot && w.profile === "" && w.group) ?? all.find((w) => w.hasRoot);
}
const action = (window, act) => ac(`return globalThis.expo.modules.ArdiaCEF.devWindow(${window}, ${JSON.stringify(act)});`);
const gesture = (sign, wobble = false, drift = false) => [
  { phase: "began", dx: wobble ? sign : 0, dy: wobble ? 5 : 0 },
  { phase: "changed", dx: 18 * sign, dy: 1 },
  ...(drift ? [{ phase: "changed", dx: 0, dy: 50 }] : []),
  { phase: "changed", dx: 22 * sign, dy: 0 },
  { phase: "changed", dx: 22 * sign, dy: 0 },
  { phase: "ended", dx: 0, dy: 0 },
].map((step, index) => ({ ...step, atMs: index * 16, timestampMs: index * 16 }));
function flick(sign) {
  const swipe = gesture(sign);
  const end = swipe.at(-1).atMs;
  const momentum = [["momentumBegan", 20], ["momentum", 14], ["momentum", 8], ["momentum", 3], ["momentumEnded", 0]]
    .map(([phase, dx], i) => ({ phase, dx: dx * sign, dy: 0, atMs: end + 8 * (i + 1), timestampMs: end + 8 * (i + 1) }));
  return [...swipe, ...momentum].map((step) => ({ ...step, dispatch: "app" }));
}
function fixtureFidelity(steps, result) {
  const start = Number(result?.startNs) / 1e9;
  const events = (result?.events ?? []).filter((e) => !e.error);
  const decodedMs = events.map((e) => (e.time - start) * 1000);
  const intendedMs = steps.map((s) => s.timestampMs);
  const ended = (result?.acks ?? []).find((a) => a.diag === "emit" && a.phase === "ended");
  const errors = [];
  if (events.length !== steps.length) errors.push(`events ${events.length}, steps ${steps.length}`);
  intendedMs.forEach((ms, i) => {
    if (!(Math.abs((decodedMs[i] ?? NaN) - ms) <= 0.1)) errors.push(`step ${i} timestamp ${decodedMs[i]}ms, requested ${ms}ms`);
  });
  if (!ended) errors.push("no ended emit");
  else if (!(Math.abs(ended.velocity) >= 5)) errors.push(`ended velocity ${ended.velocity}`);
  return { intendedMs, decodedMs, endedVelocity: ended?.velocity ?? null,
    maxLateMs: Math.max(0, ...events.map((e) => e.lateMs ?? 0)), errors };
}
const simulate = (steps, source) => ac(source
  ? `return globalThis.expo.modules.ArdiaSwipe.devSimulate(120, 400, ${source}, ${JSON.stringify(steps)}, true);`
  : `return globalThis.acSwipe.sidebar("w1").devSimulate(${JSON.stringify(steps)}, {ignorePreference:true});`);
function alternatingGestures(count, gapMs = 112) {
  return Array.from({ length: count }, (_, n) => gesture(n % 2 ? 1 : -1).map((step) => ({
    ...step, atMs: step.atMs + n * gapMs, timestampMs: step.timestampMs + n * gapMs,
  }))).flat();
}
async function nativeBatch(steps, blockedMs = 0) {
  return ac(`
    const simulation=globalThis.acSwipe.sidebar("w1").devSimulate(${JSON.stringify(steps)}, {ignorePreference:true});
    if (${blockedMs}) setTimeout(()=>{
      const until=performance.now()+${blockedMs}; while(performance.now()<until){}
    },20);
    return simulation.then(result=>new Promise(resolve=>setTimeout(()=>{
      globalThis.expo.modules.ArdiaSwipe.devPagerState("w1").then(state=>resolve({result,state,
        profile:ac.store.getState().windows.w1.profileId,pager:globalThis.acPager("w1").debug()}));
    },650)));
  `, 15000);
}
async function test(name, fn) {
  if (only && !name.toLowerCase().includes(only)) return;
  matched++;
  let fatal = null;
  await rep.check(name, async () => {
    const result = await fn();
    evidence.cases.push({ name, passed: true, result });
  }, {
    async onFail(error) {
      const death = error.appDied ? error : ownedDeath();
      const failed = { name, passed: false, error: String(error), ...(error.evidence ? { evidence: error.evidence } : {}) };
      evidence.cases.push(failed);
      if (!death) failed.windows = await windows().catch((e) => ({ error: String(e) }));
      if (error.evidence) rep.log("evidence:", JSON.stringify(error.evidence));
      fatal = death ?? ownedDeath();
      if (fatal) failed.appDeath = evidence.death;
    },
  });
  if (fatal) throw Object.assign(fatal, { reported: true });
}

async function pageEval(expression) {
  const page = await owned.page("/scroll-fixture", { timeout: 0 }).catch(() => null);
  assert.ok(page, "scroll fixture should have a CDP target");
  try {
    return await page.eval(expression, { timeout: 3000 });
  } finally { page.close(); }
}

let stage = "launch";
try {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  owned = await launch(app, {
    data, port, session: fixture,
    switches: "--disable-backgrounding-occluded-windows",
    ...(bundlePort ? { js: `127.0.0.1:${bundlePort}` } : {}),
    ready: 'return !!globalThis.acSwipe?.sidebar("w1");',
  });
  evidence.owner = { pid: owned.pid, port: owned.port, binary: owned.binary, started: owned.started, js: owned.js };
  appendFileSync(rep.logFile, `instance pid ${owned.pid}, DevTools port ${owned.port}, data ${data}\n`);
  if (bundlePort) {
    evidence.liveUpdatesDisabled = await ac(`
      const entry=[...globalThis.__r.getModules()].find(([,m])=>m.verboseName?.endsWith("/Libraries/Utilities/HMRClient.js"));
      if (!entry) throw new Error("HMR client missing");
      globalThis.__r(entry[0]).default.disable();
      return true;
    `);
  }
  stage = "the cases";

  await sleep(1000);

  await test("rapid forward/reverse profile swipes", async () => {
    await reset();
    const results = [];
    const fidelity = [];
    for (let i = 0; i < 6; i++) {
      const expected = i % 2 ? "default" : "work";
      try {
        const steps = gesture(i % 2 ? 1 : -1);
        const result = await simulate(steps);
        results.push(result);
        fidelity.push(fixtureFidelity(steps, result));
        if (fidelity.at(-1).errors.length) throw new Error(`fixture fidelity: ${fidelity.at(-1).errors.join("; ")}`);
        await waitProfile(expected);
      } catch (error) {
        error.evidence = { iteration: i, expected, results, fidelity,
          profile: await profile().catch(() => null),
          pager: await ac('return globalThis.acPager("w1").debug();').catch(() => null) };
        throw error;
      }
    }
    return { results, fidelity };
  });
  await test("small vertical start wobble keeps horizontal intent", async () => {
    await reset();
    const result = await simulate(gesture(-1, true));
    await waitProfile("work");
    return result;
  });
  await test("vertical drift after horizontal lock keeps profile swipe", async () => {
    await reset();
    const result = await simulate(gesture(-1, false, true));
    await waitProfile("work");
    return result;
  });
  await test("vertical sidebar scrolling stays native", async () => {
    await reset();
    const result = await simulate([{ phase: "began", dy: 5 }, { phase: "changed", dy: 16 },
      { phase: "changed", dy: 20 }, { phase: "ended" }]);
    assert.equal(await profile(), "default");
    assert.ok(result.events.every((e) => !e.swallowed), "vertical events must reach the scroll view");
    return result;
  });
  await test("cancelled swipe and momentum do not switch profiles", async () => {
    await reset();
    const steps = gesture(-1);
    steps[steps.length - 1].phase = "cancelled";
    steps.push({ phase: "momentumBegan", dx: -25 }, { phase: "momentum", dx: -30 }, { phase: "momentumEnded" });
    const result = await simulate(steps);
    await sleep(350);
    assert.equal(await profile(), "default");
    const next = await simulate(gesture(-1));
    await waitProfile("work");
    return { result, next };
  });
  await test("a new native drag interrupts the current settle synchronously", async () => {
    await reset();
    const result = await nativeBatch(alternatingGestures(2));
    assert.equal(result.profile, "default");
    assert.equal(result.state.selected, 0);
    assert.equal(result.state.phase, "idle");
    assert.ok(result.pager.ack >= result.state.selectionSequence, "latest selection must be acknowledged");
    return result;
  });
  await test("twelve native reversals keep the latest profile and stable coordinates", async () => {
    await reset();
    const result = await nativeBatch(alternatingGestures(12));
    assert.equal(result.profile, "default");
    assert.equal(result.state.selected, 0);
    assert.ok(Math.abs(result.state.position) < 0.003);
    assert.equal(result.state.phase, "idle");
    return result;
  });
  await test("queued selection events cannot rewind a native reversal while JS is blocked", async () => {
    await reset();
    const result = await nativeBatch(alternatingGestures(3), 700);
    assert.equal(result.profile, "work");
    assert.equal(result.state.selected, 1);
    assert.equal(result.state.phase, "idle");
    assert.ok(result.pager.ack >= result.state.selectionSequence, "latest selection must be acknowledged");
    return result;
  });
  await test("rapid profile shortcuts count every queued press", async () => {
    await reset();
    await ac('ac.runCommand({command:"nextProfile",windowId:"w1"}); ac.runCommand({command:"nextProfile",windowId:"w1"}); ac.runCommand({command:"nextProfile",windowId:"w1"}); return true;');
    await waitProfile("work");
    await sleep(450);
    const result = await ac('return globalThis.expo.modules.ArdiaSwipe.devPagerState("w1");');
    assert.equal(result.profileId, "work");
    assert.equal(result.selected, 1);
    assert.equal(result.phase, "idle");
    return result;
  });
  await test("external profile selection interrupts a native drag without a late rewind", async () => {
    await reset();
    const steps=gesture(-1).map((s)=>({...s, atMs:s.atMs*3, timestampMs:s.timestampMs*3}));
    const result = await ac(`
      const simulation=globalThis.acSwipe.sidebar("w1").devSimulate(${JSON.stringify(steps)},{ignorePreference:true});
      setTimeout(()=>ac.store.getState().switchProfile("w1","work"),40);
      setTimeout(()=>ac.store.getState().switchProfile("w1","default"),56);
      return simulation.then(native=>new Promise(resolve=>setTimeout(()=>{
        globalThis.expo.modules.ArdiaSwipe.devPagerState("w1").then(state=>resolve({native,state,
          profile:ac.store.getState().windows.w1.profileId}));
      },650)));
    `);
    assert.equal(result.profile,"default");
    assert.equal(result.state.profileId,"default");
    assert.equal(result.state.phase,"idle");
    return result;
  });
  await test("latest profile dot cancels an in-flight native selection", async () => {
    await reset();
    await simulate(gesture(-1));
    await ac('const p=globalThis.acPager("w1"); p.switchTo("default"); p.switchTo("work"); return true;');
    await waitProfile("work");
    await sleep(650);
    const result = await ac('return globalThis.expo.modules.ArdiaSwipe.devPagerState("w1");');
    assert.equal(result.selected, 1);
    assert.equal(result.phase, "idle");
    assert.ok(Math.abs(result.position - 1) < 0.003);
    return result;
  });
  await test("new gesture recovers after a missing end", async () => {
    await reset();
    const incomplete = await simulate(gesture(-1).slice(0, -1));
    const next = await simulate(gesture(-1));
    await waitProfile("work");
    return { incomplete, next };
  });
  for (const surface of ["sidebar", "strip"]) {
    await test(`a ${surface} swipe's momentum stays with it, so a third swipe at the same point switches`, async () => {
      await reset();
      if (surface === "strip") await ac('ac.store.getState().updateSettings({ tabLayout: "top" }); return true;');
      try {
        for (let start = Date.now(); Date.now() - start < 3000 && !(await ac(`return !!globalThis.acSwipe.${surface}("w1");`));) await sleep(50);
        await sleep(250);
        const results = [];
        for (const [sign, expected] of [[-1, "work"], [1, "default"], [-1, "work"]]) {
          const result = await ac(`return globalThis.acSwipe.${surface}("w1").devSimulate(${JSON.stringify(flick(sign))}, {ignorePreference:true});`, 15000);
          results.push(result);
          const leaked = (result.events ?? []).filter((e) => e.phase.startsWith("momentum") && e.monitorSwallowed !== true);
          try {
            assert.ok(result.events?.length, "the flick should be delivered");
            assert.equal(leaked.length, 0, "a profile swipe's momentum must not reach AppKit's scroll views");
            await waitProfile(expected);
          } catch (error) {
            error.evidence = { swipe: results.length, results };
            throw error;
          }
        }
        return results.map((r) => r.events.map((e) => [e.phase, e.monitorSwallowed]));
      } finally {
        if (surface === "strip") await ac('ac.store.getState().updateSettings({ tabLayout: "sidebar" }); return true;');
        for (let start = Date.now(); Date.now() - start < 3000 && !(await ac('return !!globalThis.acSwipe.sidebar("w1");'));) await sleep(50);
      }
    });
  }

  if (stale) {
    await test("stale ordinary window cannot redirect into an overlapping logical window", async () => {
      await reset();
      const source = (await nativeWindow()).window;
      const first = await simulate(gesture(-1), source);
      await waitProfile("work");
      const otherId = await ac('return ac.store.getState().createWindow({profileId:"default", frame:[80,80,1280,800]});');
      try {
        await sleep(500);
        const all = await windows();
        assert.equal(all.find((w) => w.window === source)?.profile, "work", "the source window should show the swiped-to profile");
        const other = all.find((w) => w.hasRoot && w.window !== source);
        assert.ok(other, "second logical window should exist");
        assert.equal(other.profile, "", "the second logical window should show the default profile");
        assert.equal(await action(other.window, "ns:front"), "visible=1", "overlapping logical window should be ordered front");
        const reverse = await simulate(gesture(1), source);
        assert.equal(reverse.acks.find((a) => a.diag === "begin")?.window, source, "recognition should run in the source window");
        await waitProfile("default");
        assert.equal(await ac(`return ac.store.getState().windows[${JSON.stringify(otherId)}].profileId;`), "default");
        return { source, first, reverse, other: other.window };
      } finally {
        await ac(`ac.store.getState().closeWindow(${JSON.stringify(otherId)}); return true;`);
      }
    });
    await test("visible full-screen host accepts an immediate reverse through its moved root", async () => {
      await reset();
      const source = (await nativeWindow()).window;
      await action(source, "fakeFullScreen:1");
      try {
        const first = await simulate(gesture(-1), source);
        await waitProfile("work");
        const during = (await windows()).find((w) => w.window === source);
        assert.equal(during.visible, true, "old full-screen host must remain visible for this regression");
        const reverse = await simulate(gesture(1), source);
        await waitProfile("default");
        return { source, during, first, reverse };
      } finally {
        await action(source, "fakeFullScreen:0");
      }
    });
  }
  await test("web page horizontal and vertical scrolling retain renderer ownership", async () => {
    await reset();
    const url = `http://127.0.0.1:${server.address().port}/scroll-fixture`;
    const fixtureState = await ac(`
      ac.store.getState().activate("t1");
      ac.store.getState().navigate("t1", ${JSON.stringify(url)});
      const w = ac.store.getState().windows.w1;
      return { profileId: w.profileId, activeTabId: w.activeTabIds.default };
    `);
    try {
      assert.equal(fixtureState.profileId, "default", "the fixture's profile must be active");
      assert.equal(fixtureState.activeTabId, "t1", "the fixture tab must own the visible pane");
    } catch (error) { error.evidence = { fixtureState }; throw error; }
    let loaded = false;
    for (let i = 0; i < 30 && !loaded; i++) {
      try { loaded = await pageEval('document.readyState === "complete"'); } catch { assertOwnedAlive(); }
      if (!loaded) await sleep(100);
    }
    assert.ok(loaded, "local scroll fixture must load");
    await pageEval("window.scrollTo(400,400); true");
    await sleep(100);
    const before = await pageEval("({x:scrollX,y:scrollY,url:location.href})");
    const webState = await ac(`return {
      window: ac.store.getState().windows.w1,
      pager: globalThis.acPager("w1").debug(),
      pane: !!globalThis.acSwipe.pane("t1")
    };`);
    if (!webState.pane) {
      const error = new Error("loaded web fixture has no visible t1 swipe pane");
      error.evidence = { fixtureState, webState, windows: await windows(), before };
      throw error;
    }
    const horizontal = await ac(`return globalThis.acSwipe.pane("t1").devSimulate(${JSON.stringify(gesture(-1))}, {ignorePreference:true});`);
    await sleep(250);
    const afterHorizontal = await pageEval("({x:scrollX,y:scrollY,url:location.href})");
    assert.ok(afterHorizontal.x > before.x, "horizontal page scroll must still move web content");
    assert.equal(afterHorizontal.url, before.url, "horizontal scrolling must not navigate history");
    const vertical = await ac('return globalThis.acSwipe.pane("t1").devSimulate([{phase:"began"},{phase:"changed",dy:-18},{phase:"changed",dy:-24},{phase:"ended"}], {ignorePreference:true});');
    await sleep(250);
    const afterVertical = await pageEval("({x:scrollX,y:scrollY,url:location.href})");
    assert.ok(afterVertical.y > afterHorizontal.y, "vertical page scroll must still move web content");
    assert.equal(await profile(), "default");
    return { before, afterHorizontal, afterVertical, horizontal, vertical };
  });
  const routing = (result) => result.acks.find((a) => a.diag === "hitRouting");
  const flagged = (steps, flags) => steps.map((s) => ({ ...s, ...flags }));
  await test("a renderer hit outside its own frame falls back to the sidebar pager", async () => {
    await reset();
    assert.ok(await pageEval("!!document.body"), "the web fixture renderer must exist");
    const legacy = await simulate(flagged(gesture(-1), { wrongRendererHit: true, legacyHitRouting: true }));
    await sleep(600);
    const legacyProfile = await profile();
    const legacyBegin = legacy.acks.find((a) => a.diag === "begin");
    evidence.baselineRendererHit = { profile: legacyProfile, raw: routing(legacy)?.raw?.[0]?.class,
      misses: legacyBegin?.targets?.map((t) => t.miss), reject: legacy.acks.find((a) => a.diag === "reject")?.reason };
    assert.equal(routing(legacy)?.raw?.[0]?.class, "RenderWidgetHostViewCocoa", "injection should hit the real renderer");
    assert.equal(legacyProfile, "default", "legacy hit routing should reject the misrouted renderer hit");
    const fixed = await simulate(flagged(gesture(-1), { wrongRendererHit: true }));
    await waitProfile("work");
    assert.equal(routing(fixed)?.fallback, true, "the pager should take the gesture through the fallback");
    const begin = fixed.acks.find((a) => a.diag === "begin");
    assert.ok(begin.hit.every((h) => h.class !== "RenderWidgetHostViewCocoa"), "the effective hit must not be the renderer");
    return { legacy, fixed };
  });
  await test("a real web hit inside the renderer keeps page ownership", async () => {
    await reset();
    const source = (await nativeWindow()).window;
    const result = await ac(`return globalThis.expo.modules.ArdiaSwipe.devSimulate(700, 400, ${source}, ${JSON.stringify(gesture(-1))}, true);`);
    await sleep(600);
    assert.equal(routing(result)?.raw?.[0]?.class, "RenderWidgetHostViewCocoa", "the point should hit the page renderer");
    assert.equal(routing(result)?.fallback, false, "a hit inside the renderer must not fall back");
    assert.equal(await profile(), "default", "a web-page swipe must not switch profiles");
    return result;
  });
  await test("a native sidebar hit does not use the renderer fallback", async () => {
    await reset();
    const result = await simulate(gesture(-1));
    await waitProfile("work");
    assert.notEqual(routing(result)?.raw?.[0]?.class, "RenderWidgetHostViewCocoa");
    assert.equal(routing(result)?.fallback, false, "an ordinary sidebar hit should match directly");
    return result;
  });
  await test("a tracked swipe right after a discrete swipe goes back too", async () => {
    await reset();
    const base = `http://127.0.0.1:${server.address().port}/history`;
    const url = () => ac('return ac.store.getState().tabs.t1.url;');
    async function waitUrl(expected, ms) {
      for (let start = Date.now(); Date.now() - start < ms && (await url()) !== expected;) await sleep(50);
      return url();
    }
    await ac('ac.store.getState().activate("t1"); return true;');
    for (const n of [1, 2, 3]) {
      await ac(`ac.store.getState().navigate("t1", ${JSON.stringify(base + n)}); return true;`);
      assert.equal(await waitUrl(base + n, 5000), base + n);
    }
    await sleep(500);
    const steps = [{ phase: "swipe", dx: 3, atMs: 0 }, { phase: "began", dx: 0, dy: 0, atMs: 50, timestampMs: 50 }];
    for (let at = 66; at <= 258; at += 16) steps.push({ phase: "changed", dx: 10, dy: 0, atMs: at, timestampMs: at });
    steps.push({ phase: "ended", dx: 0, dy: 0, atMs: 274, timestampMs: 274 });
    const result = await ac(`return globalThis.acSwipe.pane("t1").devSimulate(${JSON.stringify(steps)}, {ignorePreference:true});`);
    assert.equal(await waitUrl(base + 1, 3000), base + 1, "both swipes should go back");
    return { events: result.events?.map((e) => [e.phase, e.swallowed ?? e.state]) };
  });
  await test("reordering profiles preserves a native selection queued behind blocked JS", async () => {
    await reset();
    try {
      const result = await ac(`
        const simulation=globalThis.acSwipe.sidebar("w1").devSimulate(${JSON.stringify(gesture(-1))}, {ignorePreference:true});
        setTimeout(()=>{
          const until=performance.now()+180; while(performance.now()<until){}
          ac.store.getState().reorderProfiles(["work","default"]);
        },20);
        return simulation.then(native=>new Promise(resolve=>setTimeout(()=>{
          globalThis.expo.modules.ArdiaSwipe.devPagerState("w1").then(state=>resolve({native,state,
            profile:ac.store.getState().windows.w1.profileId,order:ac.store.getState().profileOrder}));
        },650)));
      `);
      assert.equal(result.profile, "work");
      assert.equal(result.state.profileId, "work");
      assert.equal(result.state.selected, 0);
      assert.ok(Math.abs(result.state.position) < 0.003);
      return result;
    } finally {
      await ac('ac.store.getState().reorderProfiles(["default","work"]); return true;');
    }
  });
  const pull = (distance) => {
    const steps = [{ phase: "began", dx: 0, dy: 0 }];
    for (let left = distance; left > 0; left -= 12) steps.push({ phase: "changed", dx: -Math.min(12, left), dy: 0 });
    steps.push({ phase: "ended", dx: 0, dy: 0 });
    return steps.map((step, index) => ({ ...step, atMs: index * 16, timestampMs: index * 16 }));
  };
  async function onLastProfile() {
    await ac('ac.store.getState().switchProfile("w1","work"); return true;');
    await waitProfile("work");
    await sleep(350);
  }
  const settingsShown = () => ac('return ac.shell.windowIds().then((ids) => ({ open: ids.includes("settings"), ...ac.settingsNav.getState() }));');
  async function waitSettingsOn(profileId) {
    let shown;
    for (let start = Date.now(); Date.now() - start < 2000; await sleep(50)) {
      shown = await settingsShown();
      if (shown.open && shown.pane === "profiles" && shown.profileId === profileId) return shown;
    }
    assert.fail(`Settings should open on ${profileId}'s editor, got ${JSON.stringify({ open: shown.open, pane: shown.pane, profileId: shown.profileId })}`);
  }
  const closeSettings = () => ac('return ac.shell.closeWindow("settings").then(() => true);');
  const settingsResponder = () => ac('return ac.shell.devKeyEquivalent("settings", { key: "x", keyCode: 7, dry: true, wait: 0 }).then((r) => r.firstResponder ?? r.error);');
  const editsText = (responder) => /TextView|TextField|FieldEditor/.test(responder);
  async function waitNameFieldFocused() {
    let responder;
    for (let start = Date.now(); Date.now() - start < 2000; await sleep(50)) if (editsText(responder = await settingsResponder())) return responder;
    assert.fail(`the Name field should be focused, Settings' first responder is ${responder}`);
  }
  async function typeInSettings(text) {
    await ac(`return ac.shell.devTypeKeys("settings", ${JSON.stringify(text)}, 20).then(() => true);`);
    await ac('return ac.shell.devTypeKeys("settings", "\\r", 20).then(() => true);');
    await sleep(300);
  }
  async function textsShownMidPull(distance) {
    const held = pull(distance).slice(0, -1);
    const releaseAt = held.at(-1).atMs + 1200;
    const steps = [...held, { phase: "ended", dx: 0, dy: 0, atMs: releaseAt, timestampMs: releaseAt }];
    return ac(`
      const hook = globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      const texts = () => {
        const found = new Set();
        for (const id of hook.renderers.keys()) for (const root of hook.getFiberRoots(id)) {
          const stack = [root.current];
          while (stack.length) {
            const f = stack.pop();
            if (typeof f.memoizedProps === "string") found.add(f.memoizedProps);
            for (let c = f.child; c; c = c.sibling) stack.push(c);
          }
        }
        return found;
      };
      const before = texts();
      const run = globalThis.acSwipe.sidebar("w1").devSimulate(${JSON.stringify(steps)}, {ignorePreference:true});
      const shown = new Set();
      const poll = (until) => new Promise((resolve) => {
        const tick = () => {
          for (const t of texts()) if (!before.has(t)) shown.add(t);
          if (Date.now() >= until) resolve();
          else setTimeout(tick, 50);
        };
        tick();
      });
      return poll(Date.now() + ${releaseAt - 100}).then(() => run).then(() => [...shown]);
    `);
  }
  await test("the page past the last profile reads New Profile while pulled, and a held short pull springs back", async () => {
    await onLastProfile();
    const shown = await textsShownMidPull(120);
    assert.ok(shown.includes("New Profile"), `the page should read New Profile, showed ${JSON.stringify(shown)}`);
    assert.ok(!shown.includes("New Space"), "the page should not say Space");
    await sleep(500);
    assert.deepEqual(await ac("return ac.store.getState().profileOrder;"), ["default", "work"]);
    assert.equal(await profile(), "work");
    return shown;
  });
  await test("pulling the New Profile page halfway in past the last profile makes a profile sharing its data and opens its editor with the Name field focused and selected", async () => {
    await onLastProfile();
    const result = await nativeBatch(pull(300));
    const s = await ac('const s=ac.store.getState(); return { order:s.profileOrder, profiles:s.profiles, shown:s.windows.w1.profileId };');
    const created = s.order[2];
    try {
      assert.equal(s.order.length, 3, "the pull should add a profile after the last one");
      assert.equal(s.shown, created, "the window should page to the new profile");
      assert.equal(s.profiles[created].dataId, "work", "the new profile shares the last profile's data");
      assert.equal(s.profiles[created].name, "Profile 3");
      assert.equal(new Set(s.order.map((id) => s.profiles[id].color)).size, 3, "the new profile takes an unused colour");
      assert.equal(result.state.profileId, created);
      assert.equal(result.state.selected, 2);
      assert.equal(result.state.count, 3);
      assert.equal(result.state.phase, "idle");
      assert.ok(Math.abs(result.state.position - 2) < 0.003, "the slide should finish on the new profile");
      const editor = await waitSettingsOn(created);
      const responder = await waitNameFieldFocused();
      await typeInSettings("Trips");
      const renamed = await ac(`return ac.store.getState().profiles[${JSON.stringify(created)}].name;`);
      assert.notEqual(renamed, "Profile 3", "typing should reach the Name field");
      assert.equal(renamed, "Trips", "typing should replace the selected name, not add to it");
      return { result, created: s.profiles[created], editor: { pane: editor.pane, profileId: editor.profileId }, responder, renamed };
    } finally {
      await closeSettings();
      await ac(`ac.store.getState().switchProfile("w1","default"); ac.store.getState().deleteProfile(${JSON.stringify(created ?? "")}); return true;`);
      await waitProfile("default");
    }
  });
  await test("with Settings already open on another pane, a pull-made profile's editor still gets its Name field focused and selected", async () => {
    await onLastProfile();
    await ac('ac.settingsNav.getState().go("general"); ac.runCommand({ command: "openSettings" }); return true;');
    for (let start = Date.now(); !(await settingsShown()).open && Date.now() - start < 2000;) await sleep(50);
    await sleep(600);
    const before = await settingsResponder();
    assert.ok(!editsText(before), `Settings › General should open with no field focused, first responder ${before}`);
    await nativeBatch(pull(300));
    const created = (await ac("return ac.store.getState().profileOrder;"))[2];
    try {
      await waitSettingsOn(created);
      const responder = await waitNameFieldFocused();
      await typeInSettings("Trips");
      assert.equal(await ac(`return ac.store.getState().profiles[${JSON.stringify(created)}].name;`), "Trips", "typing should replace the selected name");
      return { created, before, responder };
    } finally {
      await closeSettings();
      await ac(`ac.store.getState().switchProfile("w1","default"); ac.store.getState().deleteProfile(${JSON.stringify(created ?? "")}); return true;`);
      await waitProfile("default");
    }
  });
  await test("a flick short of half the New Profile page springs back and makes nothing", async () => {
    await onLastProfile();
    const result = await nativeBatch(pull(120));
    const ended = (result.result?.acks ?? []).find((a) => a.diag === "emit" && a.phase === "ended");
    assert.ok(Math.abs(ended?.velocity ?? 0) >= 5, "the release should be a flick");
    assert.deepEqual(await ac("return ac.store.getState().profileOrder;"), ["default", "work"]);
    assert.equal(result.profile, "work");
    assert.equal(result.state.selected, 1);
    assert.equal(result.state.phase, "idle");
    assert.ok(Math.abs(result.state.position - 1) < 0.003, "the pages should spring back to the last profile");
    return result;
  });
  await test("a discrete swipe past the last profile passes through and makes nothing", async () => {
    await onLastProfile();
    const result = await simulate([{ phase: "swipe", dx: -3 }]);
    await sleep(400);
    assert.equal(result.events?.[0]?.swallowed, false, "a discrete forward swipe on the last profile must reach the responder chain, as before");
    assert.deepEqual(await ac("return ac.store.getState().profileOrder;"), ["default", "work"]);
    assert.equal(await profile(), "work");
    return result.events;
  });
  await test("switching profiles during the slide onto a new profile drops its editor, even after paging back to it", async () => {
    await onLastProfile();
    const first = await ac(`
      const store = ac.store;
      const unsubscribe = store.subscribe((s, prev) => {
        if (s.profileOrder.length <= prev.profileOrder.length) return;
        unsubscribe();
        queueMicrotask(() => store.getState().switchProfile("w1", "work"));
      });
      return globalThis.acSwipe.sidebar("w1").devSimulate(${JSON.stringify(pull(300))}, {ignorePreference:true})
        .then(() => new Promise((resolve) => setTimeout(resolve, 900)))
        .then(() => ac.shell.windowIds())
        .then((ids) => ({ order: store.getState().profileOrder, shown: store.getState().windows.w1.profileId, settings: ids.includes("settings") }));
    `);
    const created = first.order[2];
    try {
      assert.equal(first.order.length, 3, "the pull should still make the profile");
      assert.equal(first.shown, "work", "the switch during the slide should win");
      assert.equal(first.settings, false, "no editor after switching away mid-slide");
      const back = await nativeBatch(gesture(-1));
      assert.equal(back.profile, created, "a swipe should page to the new profile");
      await sleep(500);
      assert.equal((await settingsShown()).open, false, "paging back later must not open the editor");
      return { first, back: back.state };
    } finally {
      await closeSettings();
      await ac(`ac.store.getState().switchProfile("w1","default"); ac.store.getState().deleteProfile(${JSON.stringify(created ?? "")}); return true;`);
      await waitProfile("default");
    }
  });
  await test("Settings › Profiles opened any other way leaves the Name field unfocused, even reopened on a pull-made profile", async () => {
    await onLastProfile();
    await nativeBatch(pull(300));
    const created = (await ac("return ac.store.getState().profileOrder;"))[2];
    try {
      await waitSettingsOn(created);
      await sleep(600);
      await closeSettings();
      await ac('ac.runCommand({ command: "openSettings" }); return true;');
      await waitSettingsOn(created);
      await sleep(600);
      const reopened = await settingsResponder();
      assert.ok(!editsText(reopened), `reopening Settings must not focus the Name field again, first responder ${reopened}`);
      await closeSettings();
      await ac('ac.settingsNav.getState().go("profiles", "work"); ac.runCommand({ command: "openSettings" }); return true;');
      await waitSettingsOn("work");
      await sleep(600);
      const edited = await settingsResponder();
      assert.ok(!editsText(edited), `Settings opened on a profile's editor, as Edit Profiles… opens it, must not focus the Name field, first responder ${edited}`);
      return { created, reopened, edited };
    } finally {
      await closeSettings();
      await ac(`ac.store.getState().switchProfile("w1","default"); ac.store.getState().deleteProfile(${JSON.stringify(created ?? "")}); return true;`);
      await waitProfile("default");
    }
  });
  await test("a private window's sidebar has no New Profile page", async () => {
    const id = await ac('return ac.store.getState().createWindow({ incognito: true, background: true });');
    try {
      await sleep(500);
      assert.equal(await ac(`return !!ac.store.getState().windows[${JSON.stringify(id)}]?.incognito;`), true);
      assert.equal(await ac(`return !!globalThis.acSwipe.sidebar(${JSON.stringify(id)});`), false, "a private window's sidebar must not page");
      return { id };
    } finally {
      await ac(`ac.store.getState().closeWindow(${JSON.stringify(id)}); return true;`);
    }
  });
  await test("removing the other profile keeps the remaining sidebar at its origin", async () => {
    await ac('ac.store.getState().switchProfile("w1","work"); return true;');
    await waitProfile("work");
    await sleep(350);
    await ac('ac.store.getState().deleteProfile("default"); return true;');
    await sleep(350);
    const result = await ac('return globalThis.expo.modules.ArdiaSwipe.devPagerState("w1");');
    assert.equal(await profile(), "work");
    assert.equal(result.count, 1);
    assert.equal(result.selected, 0);
    assert.ok(Math.abs(result.position) < 0.003);
    assert.equal(result.phase, "idle");
    assert.ok(result.areas >= 1);
    return result;
  });
  await test("the only profile's sidebar still scrolls, even from a leftward jitter, and ignores a back swipe", async () => {
    const scroll = await simulate([{ phase: "began", dy: 5 }, { phase: "changed", dy: 16 }, { phase: "changed", dy: 20 }, { phase: "ended" }]);
    assert.ok(scroll.events.every((e) => !e.swallowed), "vertical events must reach the scroll view");
    const jitter = await nativeBatch([{ phase: "began", dx: 0, dy: 0 }, { phase: "changed", dx: -1, dy: 1 }, { phase: "changed", dx: 0, dy: 16 }, { phase: "changed", dx: 0, dy: 20 }, { phase: "ended", dx: 0, dy: 0 }]
      .map((step, index) => ({ ...step, atMs: index * 16, timestampMs: index * 16 })));
    assert.ok(jitter.result.events.every((e) => !e.swallowed), "a scroll starting with a 1 pt leftward jitter must stay a scroll, not a New Profile pull");
    assert.equal(jitter.state.phase, "idle");
    assert.ok(Math.abs(jitter.state.position) < 0.003, "the sidebar should not move");
    const back = await nativeBatch(pull(300).map((step) => ({ ...step, dx: -step.dx })));
    assert.ok(back.result.events.every((e) => !e.swallowed), "a back swipe on the only profile must not be tracked");
    assert.deepEqual(await ac("return ac.store.getState().profileOrder;"), ["work"]);
    assert.equal(back.state.selected, 0);
    assert.equal(back.state.phase, "idle");
    assert.ok(Math.abs(back.state.position) < 0.003, "the sidebar should not move");
    return { scroll, jitter, back };
  });
  await test("the only profile's sidebar passes a horizontal wheel and a discrete forward swipe through, as before", async () => {
    const result = await simulate([{ phase: "wheel", dx: 1 }, { phase: "wheel", dx: -1 }, { phase: "swipe", dx: -3 }]);
    await sleep(400);
    assert.deepEqual(result.events.map((e) => [e.phase, e.swallowed]), [["wheel", false], ["wheel", false], ["swipe", false]],
      "with no other profile to page to, these must reach the responder chain");
    assert.deepEqual(await ac("return ac.store.getState().profileOrder;"), ["work"]);
    assert.equal(await profile(), "work");
    return result.events;
  });
  await test("the only profile's sidebar offers the New Profile page too", async () => {
    try {
      const result = await nativeBatch(pull(300));
      const s = await ac('const s=ac.store.getState(); return { order:s.profileOrder, profiles:s.profiles, shown:s.windows.w1.profileId };');
      assert.equal(s.order.length, 2, "the pull should add a second profile");
      assert.equal(s.shown, s.order[1]);
      assert.equal(s.profiles[s.order[1]].dataId, "work");
      assert.equal(result.state.selected, 1);
      assert.equal(result.state.count, 2);
      assert.equal(result.state.phase, "idle");
      assert.ok(Math.abs(result.state.position - 1) < 0.003, "the slide should finish on the new profile");
      await waitSettingsOn(s.order[1]);
      return result;
    } finally {
      await closeSettings();
    }
  });
  stage = "the snapshot";
  evidence.snapshot = { path: join(data, "profile-swipe.png"),
    saved: await ac(`return ac.shell.devSnapshotWindow("w1", ${JSON.stringify(join(data, "profile-swipe.png"))});`) };
} catch (error) {
  evidence.error = String(error);
  if (!error.reported) rep.record(`stopped at ${stage}`, { error });
} finally {
  if (only && !matched && !evidence.error) {
    evidence.error = `--only=${only} matched no test`;
    rep.record(`--only=${only}`, { error: "matched no test" });
  }
  if (owned) {
    try { evidence.cleanup = await owned.quit(); } catch (error) { evidence.cleanup = { error: String(error) }; }
  }
  writeFileSync(join(scratch, "profile-swipe-results.json"), JSON.stringify(evidence, null, 2));
  server.close();
  const failed = evidence.error || evidence.cases.some((c) => !c.passed);
  if (!keep && !failed) {
    rmSync(data, { recursive: true, force: true });
    rmSync(join(scratch, "profile-swipe-results.json"), { force: true });
  } else appendFileSync(rep.logFile, `evidence: ${join(scratch, "profile-swipe-results.json")}\n`);
  process.exitCode = rep.summary() && !failed ? 0 : 1;
}
