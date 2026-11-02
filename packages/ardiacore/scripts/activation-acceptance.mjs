#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { basename, join, resolve } from "node:path";
import { freePort, launch as launchInstance, reporter, sleep } from "../../../scripts/lib/instance.mjs";

const [appArg, scratchArg, ...only] = process.argv.slice(2);
if (!appArg || !scratchArg) {
  console.error("usage: activation-acceptance.mjs <Ardia.app> <scratch dir> [check…]");
  process.exit(64);
}
const scratch = resolve(scratchArg);
const data = join(scratch, "data");
rmSync(data, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
const results = [];
const report = reporter(join(data, "activation-acceptance.log"), { name: "activation acceptance" });
const log = (...a) => report.log(...a);

const app = join(scratch, "media-app", basename(resolve(appArg)));
rmSync(join(scratch, "media-app"), { recursive: true, force: true });
mkdirSync(join(scratch, "media-app"), { recursive: true });
execFileSync("cp", ["-cR", resolve(appArg), app]);
const entitlements = join(scratch, "media-app", "entitlements.plist");
writeFileSync(entitlements, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>com.apple.security.cs.disable-library-validation</key><true/></dict></plist>`);
execFileSync("codesign", ["-f", "-s", "-", "--options", "runtime", "--entitlements", entitlements, app], { stdio: "ignore" });
if (/device\.(camera|audio-input)/.test(execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", app], { stdio: ["ignore", "pipe", "ignore"] }).toString()))
  throw new Error("the media copy kept a device entitlement");

const certDir = join(scratch, "cert");
mkdirSync(certDir, { recursive: true });
writeFileSync(join(certDir, "openssl.cnf"), `[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,DNS:*.localhost,IP:127.0.0.1\n`);
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-keyout", join(certDir, "key.pem"), "-out", join(certDir, "cert.pem"), "-config", join(certDir, "openssl.cnf")], { stdio: "ignore" });

const page = (title, body, script = "") =>
  `<!doctype html><html><head><title>${title}</title><link rel="icon" href="data:,"></head><body style="font: 20px sans-serif">${body}<script>${script}</script></body></html>`;
const conference = `
  window.__pip = 0; window.__pipClosed = 0; window.__pipError = null;
  navigator.mediaSession.setActionHandler("enterpictureinpicture", async () => {
    __pip++;
    try {
      const w = await documentPictureInPicture.requestWindow({ width: 320, height: 180 });
      w.addEventListener("pagehide", () => __pipClosed++);
    } catch (e) { __pipError = e.name; }
  });
  window.join = () => navigator.mediaDevices.getUserMedia({ video: true }).then((s) => {
    window.__stream = s; const v = document.querySelector("video"); v.srcObject = s; v.play(); return "ok";
  }, (e) => e.name);
  window.state = () => ({ pip: __pip, open: !!documentPictureInPicture.window, closed: __pipClosed, error: __pipError,
    camera: window.__stream?.getVideoTracks()[0]?.readyState ?? null, visibility: document.visibilityState });`;
const asks = `
  window.__asks = [];
  window.ask = (c) => { const e = { state: "pending" }; __asks.push(e);
    navigator.mediaDevices.getUserMedia(c).then((s) => { window.__s = s; e.state = "ok"; }, (x) => { e.state = "err"; e.error = x.name; });
    return __asks.length - 1; };`;
const server = createHttpsServer({ key: readFileSync(join(certDir, "key.pem")), cert: readFileSync(join(certDir, "cert.pem")) }, (req, res) => {
  const url = new URL(req.url, "https://x");
  res.writeHead(200, { "content-type": "text/html" });
  if (url.pathname === "/conf") return res.end(page("Conference", `<video muted playsinline style="width:320px;height:180px"></video>`, conference));
  if (url.pathname === "/ask") return res.end(page("Ask", "ask", asks));
  if (url.pathname === "/keys") return res.end(page("Keys", "keys", `window.__keys = ""; addEventListener("keydown", (e) => (__keys += e.key), true);`));
  return res.end(page(url.searchParams.get("t") ?? url.pathname.slice(1), url.pathname));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;
let site = 0;
const origin = () => `https://s${++site}.localhost:${port}`;

const devtoolsPort = await freePort();
let pid = null;
let instance = null;
async function launch(logName = "app.out.log") {
  instance = await launchInstance(app, {
    data, port: devtoolsPort, log: join(scratch, logName), ready: false,
    switches: "--ignore-certificate-errors", test: { systemMediaPermission: "ask" },
  });
  pid = instance.pid;
  writeFileSync(join(scratch, "app.pid"), String(pid));
}
await launch();
const alive = () => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function evalApp(body, timeoutMs = 20000) {
  try {
    return await instance.eval(body, { timeout: timeoutMs });
  } catch (e) {
    throw e.appDied ? new Error("the app exited") : e;
  }
}
async function until(what, fn, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await sleep(200);
  }
  throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
}
const targets = async () => (await fetch(`http://127.0.0.1:${devtoolsPort}/json/list`)).json();
async function cdp(target, method, params = {}) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = () => j(new Error(`DevTools connection to ${target.url} failed`)))));
  const reply = new Promise((r) => (ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id === 1) r(msg);
  }));
  ws.send(JSON.stringify({ id: 1, method, params }));
  const msg = await Promise.race([reply, sleep(10000).then(() => ({ error: "cdp timeout" }))]);
  ws.close();
  if (msg.error) throw new Error(JSON.stringify(msg.error));
  return msg.result;
}
const js = async (target, expression) => {
  const r = await cdp(target, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const pageTarget = (urlPart) => until(urlPart, async () => (await targets()).find((t) => t.type === "page" && t.url.includes(urlPart)) ?? null, 10000);
const engine = (name, args = {}, ms) => evalApp(`return ac.engine.call(${JSON.stringify(name)}, ${JSON.stringify(args)})`, ms);

const appState = () => evalApp(`const s = ac.store.getState();
  return { focused: s.ui.focusOrder[0] ?? null, windows: Object.fromEntries(Object.values(s.windows).map((w) => {
    const shown = w.activeTabIds[w.profileId] ?? null;
    const split = Object.values(s.splits ?? {}).find((x) => x.slots.flatMap((x) => x.stack ?? [x.tabId]).includes(shown));
    return [w.id, { profile: w.profileId, shown, url: s.tabs[shown]?.url ?? null, panes: split ? split.slots.flatMap((x) => x.stack ?? [x.tabId]) : shown ? [shown] : [] }];
  })) };`);
const activationLog = () => (existsSync(join(data, "activation.log")) ? readFileSync(join(data, "activation.log"), "utf8") : "");
const focusRequests = (from = 0) =>
  [...activationLog().slice(from).matchAll(/(makeKeyAndOrderFront:|makeKeyWindow) on \S+ #(\d+)/g)].map((m) => Number(m[2]));
const nativeWindows = () => engine("windows.list");
const neverFront = () => {
  const front = execFileSync("lsappinfo", ["front"]).toString().trim();
  if (execFileSync("lsappinfo", ["info", "-only", "pid", front]).toString().includes(`=${pid}`)) throw new Error("the app took focus");
  if (activationLog().includes("became active")) throw new Error("the app became active");
};

const extDir = join(scratch, "watch-ext");
rmSync(extDir, { recursive: true, force: true });
mkdirSync(extDir, { recursive: true });
writeFileSync(join(extDir, "manifest.json"), JSON.stringify({
  manifest_version: 3, name: "Activation watch", version: "1.0", permissions: ["tabs", "storage"], background: { service_worker: "worker.js" },
}));
writeFileSync(join(extDir, "worker.js"), `
  let chain = Promise.resolve();
  const note = (e) => (chain = chain.then(async () => {
    const { events = [] } = await chrome.storage.local.get("events");
    events.push({ at: Date.now(), ...e, ...(e.url ? { url: await e.url } : {}) });
    await chrome.storage.local.set({ events });
  }));
  chrome.tabs.onActivated.addListener((i) => note({ name: "activated", tabId: i.tabId, windowId: i.windowId,
    url: chrome.tabs.get(i.tabId).then((t) => t.pendingUrl || t.url, () => null) }));
  chrome.windows.onFocusChanged.addListener((windowId) => note({ name: "focus", windowId }));
  self.events = async () => { await chain; return (await chrome.storage.local.get("events")).events ?? []; };
  self.chromeState = async () => {
    const windows = await chrome.windows.getAll({ populate: true });
    const last = await chrome.windows.getLastFocused().catch(() => null);
    return { lastFocused: last?.id ?? null,
      windows: windows.map((w) => ({ id: w.id, focused: w.focused, active: w.tabs.find((t) => t.active)?.url ?? null, tabs: w.tabs.map((t) => t.url) })) };
  };`);
let worker = null;
const ext = async (expression) => {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await cdp(worker, "Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "exception");
      return r.result.value;
    } catch (e) {
      if (attempt) throw e;
      worker = await findWorker();
    }
  }
};
let extId = null;
const findWorker = () => until("the extension's worker", async () => {
  await engine("extensions.list", { profile: "" }).catch(() => null);
  for (const t of (await targets()).filter((t) => t.type === "service_worker" && t.url.includes(extId))) {
    const r = await cdp(t, "Runtime.evaluate", { expression: "typeof self.chromeState", returnByValue: true }).catch(() => null);
    if (r?.result?.value === "function") return t;
  }
  return null;
}, 15000);
const chromeWindowOf = (state, urlPart) => state.windows.find((w) => w.tabs.some((u) => u?.includes(urlPart)))?.id ?? null;

async function check(name, fn) {
  if (only.length && !only.includes(name) && name !== "boot") return;
  const started = Date.now();
  await report.check(name, async () => {
    const evidence = await fn();
    neverFront();
    results.push({ name, ok: true, evidence, ms: Date.now() - started });
    return evidence;
  }, {
    async onFail(e) {
      let snapshot = null;
      try {
        snapshot = { app: await appState(), chrome: worker ? await ext("chromeState()") : null };
      } catch {}
      results.push({ name, ok: false, error: String(e?.message ?? e), snapshot, ms: Date.now() - started });
      log(`state: ${JSON.stringify(snapshot)}`);
    },
  });
}

let mainWindow;
const openTab = async (url, title, windowId = mainWindow) => {
  const before = new Set(Object.keys(await evalApp(`return ac.store.getState().tabs`)));
  await evalApp(`ac.actions.openUrls([${JSON.stringify(url)}], ${JSON.stringify(windowId)}); return true`);
  return until(`a tab for ${url}`, () => evalApp(`const s = ac.store.getState();
    return Object.values(s.tabs).find((t) => !${JSON.stringify([...before])}.includes(t.id) && t.title === ${JSON.stringify(title)} && !s.live[t.id]?.isLoading)?.id ?? null`), 20000);
};
const show = async (tabId) => {
  await evalApp(`ac.actions.switchToTab(${JSON.stringify(tabId)}); return true`);
  await until(`${tabId} shown`, async () => Object.values((await appState()).windows).some((w) => w.panes.includes(tabId)) && evalApp(`return !!ac.webviews.get(${JSON.stringify(tabId)})`), 10000);
};
const closeTab = (id) => evalApp(`ac.store.getState().closeTab(${JSON.stringify(id)}); return true`).catch(() => null);
const prompt = (tabId) => evalApp(`return ac.pageState.getState().pages[${JSON.stringify(tabId)}]?.permission ?? null`);
const answer = (tabId, id, result) => evalApp(`ac.permissions.answerPermission(${JSON.stringify(tabId)}, ${JSON.stringify(id)}, ${JSON.stringify(result)}); return true`);
async function joinedCall(windowId = mainWindow) {
  const url = `${origin()}/conf`;
  const tab = await openTab(url, "Conference", windowId);
  await show(tab);
  const t = await pageTarget(url);
  await js(t, "join(); true");
  const request = await until("the camera prompt", () => prompt(tab), 10000);
  await answer(tab, request.id, "accept");
  await until("the camera live", async () => (await js(t, "state()")).camera === "live", 10000);
  await sleep(500);
  return { tab, t, url };
}
const pipState = (t) => js(t, "state()");
const booted = () => until("the dev harness", async () => {
  try {
    return await engine("engine.info", {}, 3000);
  } catch (e) {
    if (!alive()) throw e;
    return null;
  }
}, 90000);
const setAppActive = async (active) => {
  const n = (await nativeWindows())[0]?.window;
  const r = await engine("windows.dev", { window: n, action: `fakeAppActive:${active ? 1 : 0}` });
  if (r !== (active ? "1" : "0")) throw new Error(`fakeAppActive: ${JSON.stringify(r)} (a build without the seam?)`);
};
const keyWindow = async () => (await nativeWindows()).find((w) => w.key)?.window ?? null;

try {
  await check("boot", async () => {
    await booted();
    mainWindow = await until("a window", async () => (await appState()).focused ?? Object.keys((await appState()).windows)[0], 30000);
    const installed = await evalApp(`return ac.engine.call("extensions.install", ${JSON.stringify({ profile: "", path: extDir })}).catch((e) => ({ error: e.message }))`);
    if (installed?.error) throw new Error(installed.error);
    extId = installed.id;
    worker = await findWorker();
    return { window: mainWindow, extension: extId, https: port };
  });
  await check("split-pane-focus", async () => {
    const call = await joinedCall();
    const notes = await openTab(`${origin()}/notes?t=Notes`, "Notes");
    try {
      const split = await evalApp(`return ac.store.getState().createSplit(["${call.tab}", "${notes}"])`);
      if (!split) throw new Error("no split");
      await show(call.tab);
      await until("both panes shown", async () => {
        const w = (await appState()).windows[mainWindow];
        return w.panes.includes(call.tab) && w.panes.includes(notes);
      });
      await until("the call's window closed", async () => !(await pipState(call.t)).open, 8000);
      await sleep(800);
      const base = (await pipState(call.t)).pip;
      const focusSteps = [];
      for (const [pane, url] of [[notes, "/notes"], [call.tab, "/conf"], [notes, "/notes"], [call.tab, "/conf"], [notes, "/notes"]]) {
        await engine("tabs.devFocusPage", { tabId: pane });
        const chrome = await until(`Chrome selects the ${url} pane`, async () => {
          const c = await ext("chromeState()");
          return c.windows.some((w) => w.active?.includes(url)) ? c : null;
        }, 8000);
        await sleep(900);
        const p = await pipState(call.t);
        focusSteps.push({ chromeActive: url, pip: p.pip - base, open: p.open });
        if (p.pip !== base || p.open) throw new Error(`focusing a pane popped the call out: ${JSON.stringify(focusSteps)}`);
      }
      const other = await openTab(`${origin()}/other?t=Other`, "Other");
      await show(other);
      await until("the call popped out", async () => {
        const p = await pipState(call.t);
        return p.pip > base && p.open ? p : null;
      }, 8000);
      await sleep(1500);
      const settled = await pipState(call.t);
      if (settled.pip !== base + 1) throw new Error(`the handler ran ${settled.pip - base} times leaving the split`);
      const chromeAway = await ext("chromeState()");
      await show(call.tab);
      const back = await until("the call's window closed", async () => {
        const p = await pipState(call.t);
        return !p.open ? p : null;
      }, 8000);
      await sleep(1000);
      const after = await pipState(call.t);
      if (after.pip !== base + 1 || after.open) throw new Error(`after coming back: ${JSON.stringify(after)}`);
      await closeTab(other);
      return { focusSteps, leave: { handlerCalls: settled.pip - base, chromeActive: chromeAway.windows.map((w) => w.active) }, back: { open: back.open } };
    } finally {
      await closeTab(notes);
      await closeTab(call.tab);
    }
  });

  await check("internal-page-and-space", async () => {
    const call = await joinedCall();
    const steps = {};
    try {
      const ntp = await evalApp(`return ac.store.getState().newTab(${JSON.stringify(mainWindow)})`);
      await until("the New Tab page shown", async () => (await appState()).windows[mainWindow].shown === ntp);
      const out = await until("the call popped out (New Tab)", async () => {
        const p = await pipState(call.t);
        return p.pip >= 1 && p.open ? p : null;
      }, 8000);
      await sleep(1200);
      const chrome = await ext("chromeState()");
      steps.newTab = { pip: (await pipState(call.t)).pip, chromeActive: chrome.windows.find((w) => w.tabs.some((u) => u?.includes("/conf")))?.active };
      if (steps.newTab.pip !== 1) throw new Error(`New Tab: the handler ran ${steps.newTab.pip} times`);
      await show(call.tab);
      await until("closed on return (New Tab)", async () => !(await pipState(call.t)).open, 8000);
      await closeTab(ntp);
      const personal = (await appState()).windows[mainWindow].profile;
      const work = await evalApp(`return ac.store.getState().createProfile({ name: "Work" })`);
      await evalApp(`ac.actions.switchProfile(${JSON.stringify(mainWindow)}, ${JSON.stringify(work)}); return true`);
      await until("the Work Space shown", async () => (await appState()).windows[mainWindow].profile === work, 10000);
      await until("the call popped out (Space)", async () => {
        const p = await pipState(call.t);
        return p.pip >= 2 && p.open ? p : null;
      }, 8000);
      await sleep(1200);
      steps.space = { pip: (await pipState(call.t)).pip };
      if (steps.space.pip !== 2) throw new Error(`Space: the handler ran ${steps.space.pip - 1} times`);
      await evalApp(`ac.actions.switchProfile(${JSON.stringify(mainWindow)}, ${JSON.stringify(personal)}); return true`);
      await show(call.tab);
      await until("closed on return (Space)", async () => !(await pipState(call.t)).open, 8000);
      return steps;
    } finally {
      await closeTab(call.tab);
    }
  });

  await check("call-window-covered", async () => {
    const call = await joinedCall();
    const n = await engine("tabs.devWindowNumber", { tabId: call.tab });
    const win = (action) => engine("windows.dev", { window: n, action });
    const out = {};
    try {
      await win("fakeOcclusion:visible");
      await sleep(600);
      const base = (await pipState(call.t)).pip;
      await win("fakeOcclusion:occluded");
      await until("the call popped out (covered)", async () => {
        const p = await pipState(call.t);
        return p.pip > base && p.open ? p : null;
      }, 8000);
      await sleep(1200);
      out.covered = (await pipState(call.t)).pip - base;
      if (out.covered !== 1) throw new Error(`covered: the handler ran ${out.covered} times`);
      await win("fakeOcclusion:visible");
      await until("closed with the window back", async () => !(await pipState(call.t)).open, 8000);
      await win("fakeFullScreenMs:700");
      const before = (await pipState(call.t)).pip;
      for (const gap of [-150, 40, 120, 300, 40]) {
        await win(`fakeFullScreenOcclusionMs:${gap}`);
        for (const want of [true, false]) {
          const r = await js(call.t, want ? "document.documentElement.requestFullscreen().then(() => 'ok', (e) => e.name)" : "document.exitFullscreen().then(() => 'ok', (e) => e.name)");
          if (r !== "ok") throw new Error(`full screen ${want}: ${r}`);
          await until(`the window ${want ? "in" : "out of"} full screen`, async () => {
            const w = JSON.parse(await win("fullScreen"));
            return w.fullScreen === want && !w.pageFullScreen?.transitioning ? w : null;
          }, 6000);
        }
        await sleep(Math.max(0, gap) + 600);
        const p = await pipState(call.t);
        if (p.pip !== before || p.open) throw new Error(`full screen in and out (visible again ${gap} ms after) popped the call out: ${JSON.stringify(p)}`);
      }
      out.fullScreenRounds = 5;
      return out;
    } finally {
      for (const action of ["fakeFullScreenOcclusionMs:-1", "fakeFullScreenMs:0", "fakeOcclusion:off"]) await win(action).catch(() => null);
      await closeTab(call.tab);
    }
  });

  await check("prompt-follows-page", async () => {
    const url = `${origin()}/ask`;
    const tab = await openTab(url, "Ask");
    await show(tab);
    const t = await pageTarget(url);
    const out = {};
    try {
      await js(t, "ask({ video: true })");
      const first = await until("the prompt", () => prompt(tab), 10000);
      const ntp = await evalApp(`return ac.store.getState().newTab(${JSON.stringify(mainWindow)})`);
      await until("the New Tab page shown", async () => (await appState()).windows[mainWindow].shown === ntp);
      await sleep(800);
      const kept = await prompt(tab);
      if (kept?.id !== first.id) throw new Error(`the open prompt went with the switch: ${JSON.stringify(kept)}`);
      if ((await js(t, "__asks[0].state")) !== "pending") throw new Error("the request was answered while hidden");
      await show(tab);
      await answer(tab, first.id, "dismiss");
      await until("the first answered", async () => (await js(t, "__asks[0].state")) !== "pending", 5000);
      out.open = "kept with its page";
      await evalApp(`ac.actions.switchToTab(${JSON.stringify(ntp)}); return true`);
      await until("the New Tab page shown", async () => (await appState()).windows[mainWindow].shown === ntp);
      await sleep(600);
      await js(t, "ask({ video: true })");
      await sleep(1500);
      const whileHidden = await prompt(tab);
      if (whileHidden) throw new Error(`a hidden page prompted: ${JSON.stringify(whileHidden)}`);
      await show(tab);
      const shown = await until("the prompt once shown", () => prompt(tab), 8000);
      await answer(tab, shown.id, "dismiss");
      out.hidden = "asked once shown";
      await closeTab(ntp);
      const other = await openTab(`${origin()}/b?t=B`, "B");
      await evalApp(`return ac.store.getState().createSplit(["${tab}", "${other}"])`);
      await show(other);
      await engine("tabs.devFocusPage", { tabId: other });
      await until("Chrome selects the other pane", async () => (await ext("chromeState()")).windows.some((w) => w.active?.includes("/b")), 8000);
      await sleep(600);
      await js(t, "ask({ video: true })");
      const pane = await until("the unfocused pane's prompt", () => prompt(tab), 8000);
      await answer(tab, pane.id, "dismiss");
      out.pane = "asked at once";
      await closeTab(other);
      return out;
    } finally {
      await closeTab(tab);
    }
  });

  await check("background-window", async () => {
    const home = await openTab(`${origin()}/home?t=Home`, "Home");
    await show(home);
    const s0 = await ext("chromeState()");
    const homeChrome = chromeWindowOf(s0, "/home");
    if (s0.lastFocused !== homeChrome) throw new Error(`before: Chrome's last focused ${s0.lastFocused}, the user's window ${homeChrome}`);
    const profileBefore = (await engine("engine.info")).lastUsedProfile;
    const logFrom = activationLog().length;
    const numbersBefore = new Set((await nativeWindows()).map((w) => w.window));
    const behind = await evalApp(`return ac.actions.openWindow({ url: "${origin()}/behind?t=Behind", background: true })`);
    const first = await until("its tab loaded", () => evalApp(`const s = ac.store.getState(); const w = s.windows[${JSON.stringify(behind)}];
      const t = w && s.tabs[w.activeTabIds[w.profileId]]; return t?.title === "Behind" && !s.live[t.id]?.isLoading ? t.id : null`), 20000);
    const second = await openTab(`${origin()}/behind2?t=Behind2`, "Behind2", behind);
    const behindNumber = await until("its native window", async () => (await nativeWindows()).find((w) => !numbersBefore.has(w.window))?.window ?? null);
    const steps = [];
    const verify = async (step) => {
      await sleep(800);
      const c = await ext("chromeState()");
      const a = await appState();
      const lastUsed = (await engine("engine.info")).lastUsedProfile;
      const focusedBehind = focusRequests(logFrom).includes(behindNumber);
      steps.push({ step, lastFocused: c.lastFocused === homeChrome ? "user's" : c.lastFocused, lastUsed, appFocused: a.focused === mainWindow ? "user's" : a.focused });
      if (c.lastFocused !== homeChrome) throw new Error(`${step}: Chrome's last focused window is ${c.lastFocused}, not the user's ${homeChrome}`);
      if (lastUsed !== profileBefore) throw new Error(`${step}: last used profile ${lastUsed}, was ${profileBefore}`);
      if (focusedBehind) throw new Error(`${step}: the app asked AppKit to focus the window behind`);
      if (c.windows.find((w) => w.id === homeChrome)?.active?.includes("/home") !== true) throw new Error(`${step}: Chrome's selected tab in the user's window moved`);
    };
    try {
      await verify("made behind");
      const work = await evalApp(`return Object.keys(ac.store.getState().profiles).find((p) => p !== ac.store.getState().windows[${JSON.stringify(mainWindow)}].profileId) ?? ac.store.getState().createProfile({ name: "Work2" })`);
      await evalApp(`ac.store.getState().switchProfile(${JSON.stringify(behind)}, ${JSON.stringify(work)}); return true`);
      await until("its Space changed", async () => (await appState()).windows[behind]?.profile === work, 10000);
      await verify("Space changed");
      await evalApp(`ac.store.getState().switchProfile(${JSON.stringify(behind)}, ac.store.getState().windows[${JSON.stringify(mainWindow)}].profileId); return true`);
      await sleep(500);
      await closeTab(second);
      await verify("shown tab closed");
      return { steps, first };
    } finally {
      await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(behind)}); return true`).catch(() => null);
      await closeTab(home);
    }
  });

  await check("extension-window-focus", async () => {
    const home = await openTab(`${origin()}/home2?t=Home2`, "Home2");
    await show(home);
    const numbersBefore = new Set((await nativeWindows()).map((w) => w.window));
    const other = await evalApp(`return ac.actions.openWindow({ url: "${origin()}/b-window?t=BWindow", background: true })`);
    await until("B's tab", () => evalApp(`const s = ac.store.getState(); const w = s.windows[${JSON.stringify(other)}];
      return s.tabs[w?.activeTabIds[w?.profileId]]?.title === "BWindow" ? true : null`), 20000);
    const bNumber = await until("B's native window", async () => (await nativeWindows()).find((w) => !numbersBefore.has(w.window))?.window ?? null);
    const aNumber = (await nativeWindows()).find((w) => w.window !== bNumber && numbersBefore.has(w.window))?.window;
    try {
      await evalApp(`ac.actions.focus(${JSON.stringify(mainWindow)}); return true`);
      const s0 = await ext("chromeState()");
      const a = chromeWindowOf(s0, "/home2"), b = chromeWindowOf(s0, "/b-window");
      await until("A Chrome's last focused", async () => ((await ext("chromeState()")).lastFocused === a ? true : null), 5000)
        .catch(async () => { throw new Error(`before: last focused ${(await ext("chromeState()")).lastFocused}, A is ${a}`); });
      const steps = [];
      for (const [target, number, name] of [[b, bNumber, "B"], [a, aNumber, "A"]]) {
        const logFrom = activationLog().length;
        await ext(`chrome.windows.update(${target}, { focused: true }).then(() => true)`);
        const asked = await until(`AppKit asked to focus ${name}`, async () => (focusRequests(logFrom).includes(number) ? true : null), 5000);
        const c = await until(`Chrome's last focused is ${name}`, async () => {
          const c = await ext("chromeState()");
          return c.lastFocused === target ? c : null;
        }, 5000);
        steps.push({ window: name, askedAppKit: asked, lastFocused: name });
      }
      const logFrom = activationLog().length;
      await ext(`chrome.windows.update(${b}, { focused: false }).then(() => true)`);
      await sleep(800);
      if ((await ext("chromeState()")).lastFocused !== a || focusRequests(logFrom).length) throw new Error("focused: false changed focus");
      steps.push({ unfocus: "no change" });
      return steps;
    } finally {
      await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(other)}); return true`).catch(() => null);
      await closeTab(home);
    }
  });

  await check("quiet-commands", async () => {
    const call = await joinedCall();
    const notes = await openTab(`${origin()}/notes2?t=Notes2`, "Notes2");
    try {
      await evalApp(`return ac.store.getState().createSplit(["${call.tab}", "${notes}"])`);
      await show(notes);
      await engine("tabs.devFocusPage", { tabId: notes });
      await until("Chrome selects the notes pane", async () => (await ext("chromeState()")).windows.some((w) => w.active?.includes("/notes2")), 8000);
      await sleep(800);
      const base = (await pipState(call.t)).pip;
      const splitWindow = chromeWindowOf(await ext("chromeState()"), "/notes2");
      const activations = async (from) => (await ext("events()")).slice(from).filter((e) => e.name === "activated" && e.windowId === splitWindow);
      let eventsBefore = (await ext("events()")).length;
      const logFrom = activationLog().length;
      await evalApp(`return ac.webviews.get(${JSON.stringify(call.tab)}).runPageCommand("savePage")`);
      const saved = await until("the save panel (logged, not shown)", async () => (activationLog().slice(logFrom).includes("save panel") ? true : null), 8000);
      await sleep(800);
      const c = await ext("chromeState()");
      const events = await activations(eventsBefore);
      if (events.length) throw new Error(`Save Page: tabs.onActivated fired: ${JSON.stringify(events)}`);
      if (!c.windows.some((w) => w.active?.includes("/notes2"))) throw new Error(`Chrome's selection moved: ${JSON.stringify(c.windows.map((w) => w.active))}`);
      eventsBefore = (await ext("events()")).length;
      await evalApp(`return ac.webviews.get(${JSON.stringify(call.tab)}).showDevTools("console")`);
      const devtools = await until("DevTools for the call", async () => (await targets()).find((t) => t.url.startsWith("devtools://")) ?? null, 8000);
      await sleep(1200);
      const p = await pipState(call.t);
      if (p.pip !== base || p.open) throw new Error(`the call popped out: ${JSON.stringify(p)}`);
      return { savePage: { saved, activated: 0 }, devTools: { opened: devtools.url.slice(0, 30), chromeSelections: (await activations(eventsBefore)).length }, pip: p.pip - base };
    } finally {
      await evalApp(`return ac.webviews.get(${JSON.stringify(call.tab)})?.closeDevTools?.()`).catch(() => null);
      await closeTab(notes);
      await closeTab(call.tab);
    }
  });

  const typeIntoNewWindow = async (text) => {
    const windowsBefore = Object.keys((await appState()).windows);
    await evalApp(`return ac.engine.call("windows.list").then((list) => {
        const known = new Set(list.map((w) => w.window));
        globalThis.acDevMountDelayMs = 800;
        ac.runCommand({ command: "newWindow", arg: null, windowId: null });
        const started = Date.now();
        return new Promise((resolve, reject) => {
          const poll = () => ac.engine.call("windows.list").then((list) => {
            if (list.some((x) => !known.has(x.window))) return ac.shell.devTypeKeys("key", ${JSON.stringify(text)}, 15).then(() => resolve(true));
            if (Date.now() - started > 5000) return reject(new Error("no new window"));
            setTimeout(poll, 2);
          }, reject);
          poll();
        });
      }).finally(() => { delete globalThis.acDevMountDelayMs; });`);
    return until("the new window in the store", async () => Object.keys((await appState()).windows).find((id) => !windowsBefore.includes(id)) ?? null, 5000);
  };
  const keysPage = async () => {
    const url = `${origin()}/keys?t=Keys`;
    const tab = await openTab(url, "Keys");
    await show(tab);
    const t = await pageTarget(url);
    await evalApp(`ac.actions.focus(${JSON.stringify(mainWindow)}); return true`);
    await engine("tabs.devFocusPage", { tabId: tab });
    await js(t, "__keys = ''; true");
    return { tab, t };
  };

  await check("type-after-new-window", async () => {
    const { tab, t } = await keysPage();
    const text = "ardia";
    let made = null;
    try {
      made = await typeIntoNewWindow(text);
      const field = await until("the new window's field to hold the text", async () => {
        const fields = await evalApp(`return ac.omnibox.ids().filter((id) => id.startsWith(${JSON.stringify(made + ":")})).map((id) => ac.omnibox.get(id).state().typed)`);
        return fields.find((v) => v === text) ?? null;
      }, 5000).catch(async (e) => {
        throw new Error(`${e.message}: fields ${JSON.stringify(await evalApp(`return ac.omnibox.ids().map((id) => [id, ac.omnibox.get(id).state().typed])`))}, old page got ${JSON.stringify(await js(t, "__keys"))}`);
      });
      const oldPage = await js(t, "__keys");
      if (oldPage) throw new Error(`the old window's page got keys: ${JSON.stringify(oldPage)}`);
      return { field, oldPage };
    } finally {
      if (made) await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(made)}); return true`).catch(() => null);
      await closeTab(tab);
    }
  });

  await check("type-return-after-new-window", async () => {
    const { tab, t } = await keysPage();
    const url = `${origin()}/typed?t=Typed`;
    let made = null;
    try {
      made = await typeIntoNewWindow(`${url}\r`);
      const opened = await until("the typed address in the new window", () => evalApp(`const s = ac.store.getState();
        return Object.values(s.tabs).find((x) => x.windowId === ${JSON.stringify(made)} && x.url?.includes("/typed"))?.url ?? null`), 10000)
        .catch(async (e) => {
          throw new Error(`${e.message}: its tabs ${JSON.stringify(await evalApp(`const s = ac.store.getState(); return Object.values(s.tabs).filter((x) => x.windowId === ${JSON.stringify(made)}).map((x) => x.url)`))}`);
        });
      const oldPage = await js(t, "__keys");
      if (oldPage) throw new Error(`the old window's page got keys: ${JSON.stringify(oldPage)}`);
      return { opened: new URL(opened).pathname };
    } finally {
      if (made) await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(made)}); return true`).catch(() => null);
      await closeTab(tab);
    }
  });

  await check("plain-key-on-page", async () => {
    const url = `${origin()}/plain?t=Plain`;
    const tab = await openTab(url, "Plain");
    const n = await engine("tabs.devWindowNumber", { tabId: tab });
    try {
      await show(tab);
      await evalApp(`ac.actions.focus(${JSON.stringify(mainWindow)}); return true`);
      await engine("tabs.devFocusPage", { tabId: tab });
      const logFrom = activationLog().length;
      await evalApp(`return ac.shell.devTypeKeys("key", "f", 20)`);
      await sleep(1500);
      const w = JSON.parse(await engine("windows.dev", { window: n, action: "fullScreen" }));
      const toggled = activationLog().slice(logFrom).includes("toggleFullScreen");
      if (w.fullScreen || toggled) throw new Error(`"f" toggled the window's full screen: ${JSON.stringify({ fullScreen: w.fullScreen, toggled })}`);
      return { fullScreen: false };
    } finally {
      await engine("windows.dev", { window: n, action: "fakeFullScreen:0" }).catch(() => null);
      await closeTab(tab);
    }
  });

  await check("chrome-tab-to-front-window", async () => {
    const home = await openTab(`${origin()}/front-a?t=FrontA`, "FrontA");
    await show(home);
    const other = await evalApp(`return ac.actions.openWindow({ url: "${origin()}/front-b?t=FrontB", background: true })`);
    await until("B's tab", () => evalApp(`const s = ac.store.getState(); const w = s.windows[${JSON.stringify(other)}];
      return s.tabs[w?.activeTabIds[w?.profileId]]?.title === "FrontB" ? true : null`), 20000);
    const steps = [];
    try {
      for (const [win, name] of [[other, "B"], [mainWindow, "A"], [other, "B"]]) {
        await evalApp(`ac.actions.focus(${JSON.stringify(win)}); return true`);
        await sleep(300);
        const path = `/made-${steps.length}`;
        await ext(`chrome.windows.create({ url: "${origin()}${path}?t=Made" }).then(() => true)`);
        const placed = await until(`the made tab in the app`, () => evalApp(`return Object.values(ac.store.getState().tabs).find((t) => t.url?.includes(${JSON.stringify(path)}))?.windowId ?? null`), 15000);
        steps.push({ front: name, landed: placed === mainWindow ? "A" : placed === other ? "B" : placed });
        await evalApp(`const t = Object.values(ac.store.getState().tabs).find((t) => t.url?.includes(${JSON.stringify(path)})); if (t) ac.store.getState().closeTab(t.id); return true`);
        if (placed !== win) throw new Error(`front ${name}, the tab went to ${placed}: ${JSON.stringify(steps)}`);
      }
      return steps;
    } finally {
      await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(other)}); return true`).catch(() => null);
      await closeTab(home);
    }
  });

  await check("split-click-after-host-focus", async () => {
    const a = await openTab(`${origin()}/pane-a?t=PaneA`, "PaneA");
    const b = await openTab(`${origin()}/pane-b?t=PaneB`, "PaneB");
    const rounds = [];
    try {
      await evalApp(`return ac.store.getState().createSplit(["${a}", "${b}"])`);
      await show(a);
      await until("both panes shown", async () => {
        const w = (await appState()).windows[mainWindow];
        return w.panes.includes(a) && w.panes.includes(b);
      });
      await sleep(600);

      for (let i = 0; i < 3; i++) {
        await evalApp(`ac.actions.switchToTab(${JSON.stringify(b)});
          return new Promise((r) => setTimeout(() => { ac.actions.switchToTab(${JSON.stringify(a)}); r(true); }, 40))`);
        await sleep(50);
        await engine("tabs.devFocusPage", { tabId: b });
        const shown = await until("B active after the click", async () => ((await appState()).windows[mainWindow].shown === b ? b : null), 3000)
          .catch(async () => { throw new Error(`round ${i}: the click into B was dropped (shown ${(await appState()).windows[mainWindow].shown === a ? "A" : "?"})`); });
        rounds.push(shown === b ? "B" : shown);
        await sleep(400);
      }
      return { rounds };
    } finally {
      await closeTab(a);
      await closeTab(b);
    }
  });

  await check("app-inactive", async () => {
    const home = await openTab(`${origin()}/inactive-a?t=InactiveA`, "InactiveA");
    await show(home);
    const numbersBefore = new Set((await nativeWindows()).map((w) => w.window));
    const other = await evalApp(`return ac.actions.openWindow({ url: "${origin()}/inactive-b?t=InactiveB", background: true })`);
    await until("B's tab", () => evalApp(`const s = ac.store.getState(); const w = s.windows[${JSON.stringify(other)}];
      return s.tabs[w?.activeTabIds[w?.profileId]]?.title === "InactiveB" ? true : null`), 20000);
    const bNumber = await until("B's native window", async () => (await nativeWindows()).find((w) => !numbersBefore.has(w.window))?.window ?? null);
    try {
      await evalApp(`ac.actions.focus(${JSON.stringify(mainWindow)}); return true`);
      const s0 = await ext("chromeState()");
      const a = chromeWindowOf(s0, "/inactive-a"), b = chromeWindowOf(s0, "/inactive-b");
      await until("A Chrome's last focused", async () => ((await ext("chromeState()")).lastFocused === a ? true : null), 5000);
      const aNumber = await keyWindow();
      await setAppActive(false);
      const logFrom = activationLog().length;
      await ext(`chrome.windows.update(${b}, { focused: true }).then(() => true)`);
      await sleep(1000);
      const asked = focusRequests(logFrom);
      const c = await ext("chromeState()");
      if (asked.includes(bNumber)) throw new Error("AppKit was asked to focus B while the app is inactive");
      if (c.lastFocused !== a) throw new Error(`Chrome's last focused moved to ${c.lastFocused} (A is ${a})`);
      await setAppActive(true);
      const back = await keyWindow();
      if (back !== aNumber) throw new Error(`back in the app the key window is ${back}, was ${aNumber}`);
      await until("A Chrome's last focused again", async () => ((await ext("chromeState()")).lastFocused === a ? true : null), 5000);
      return { askedAppKit: asked.length, lastFocused: "A", keyBack: "A" };
    } finally {
      await setAppActive(true).catch(() => null);
      await evalApp(`ac.store.getState().closeWindow(${JSON.stringify(other)}); return true`).catch(() => null);
      await closeTab(home);
    }
  });

  await check("restore-activates-once", async () => {
    if (!(await appState()).windows[mainWindow]) mainWindow = await evalApp(`return ac.actions.openWindow({})`);
    const ra = await openTab(`${origin()}/restore-a?t=RestoreA`, "RestoreA");
    const rb = await openTab(`${origin()}/restore-b?t=RestoreB`, "RestoreB");
    await evalApp(`return ac.store.getState().createSplit(["${ra}", "${rb}"])`);
    await show(ra);
    const other = await evalApp(`return ac.actions.openWindow({ url: "${origin()}/restore-c?t=RestoreC", background: true })`);
    await until("C's tab", () => evalApp(`const s = ac.store.getState(); const w = s.windows[${JSON.stringify(other)}];
      return s.tabs[w?.activeTabIds[w?.profileId]]?.title === "RestoreC" ? true : null`), 20000);
    const rd = await openTab(`${origin()}/restore-d?t=RestoreD`, "RestoreD", other);
    await evalApp(`ac.actions.switchToTab(${JSON.stringify(rd)}); return true`);
    await until("D shown", async () => (await appState()).windows[other]?.shown === rd);
    await sleep(1500);
    const pathOf = (url) => new URL(url).pathname;
    const before = await appState();
    const want = { "/restore-a": pathOf(before.windows[mainWindow].url), "/restore-d": pathOf(before.windows[other].url) };
    await evalApp(`return ac.shell.devKeyEquivalent(${JSON.stringify(mainWindow)}, { key: "q", keyCode: 12, modifiers: ["command"], focus: "window" })`, 5000).catch(() => null);
    await until("the app to exit", async () => !alive(), 30000);
    const relaunched = Date.now();
    await launch("app-restored.out.log");
    await booted();
    worker = await findWorker();
    await until("the restored windows' selected tabs", async () => {
      const c = await ext("chromeState()");
      return Object.keys(want).every((p) => c.windows.some((w) => w.active && w.tabs.some((u) => u?.includes(p)))) ? c : null;
    }, 30000);
    await sleep(2500);
    const final = await ext("chromeState()");
    const events = (await ext("events()")).filter((e) => e.at >= relaunched && e.name === "activated");
    const out = {};
    for (const [path, active] of Object.entries(want)) {
      const w = final.windows.find((x) => x.tabs.some((u) => u?.includes(path)));
      if (!w || out[w.id]) continue;
      const selected = events.filter((e) => e.windowId === w.id).map((e) => (e.url ? pathOf(e.url) : `#${e.tabId}`));
      out[w.id] = { selected, active: w.active && pathOf(w.active), want: active };
      if (out[w.id].active !== active) throw new Error(`a window selects ${out[w.id].active}, the store ${active}: ${JSON.stringify(out)}`);
      const after = selected.slice(1);
      if (!selected.length || after.length > 1 || after.some((p) => p !== active)) throw new Error(`selections: ${JSON.stringify(out)}`);
    }
    if (Object.keys(out).length !== 2) throw new Error(`restored windows: ${JSON.stringify(final.windows)}`);
    mainWindow = await until("a window", async () => (await appState()).focused ?? Object.keys((await appState()).windows)[0], 30000);
    return out;
  });
} finally {
  await instance.quit();
  try {
    execFileSync(resolve(new URL(".", import.meta.url).pathname, "../../../scripts/agent/unregister-builds"), [], { stdio: "ignore" });
  } catch {}
  server.close();
  writeFileSync(join(scratch, "activation-results.json"), JSON.stringify(results, null, 2));
  process.exit(report.summary() ? 0 : 1);
}
