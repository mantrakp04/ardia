import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { openSync, closeSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

assert.ok(process.argv[2], "Pass the packaged Linux executable and optionally a Linux UI directory");
const binary = resolve(process.argv[2]);
const scratch = await mkdtemp(`${tmpdir()}/ardia-keyboard-session-`);
const profileId = "default";
const restoredId = "restored-browser";
const tabId = "restored-tab";
const seed = {
  profiles: { [profileId]: { id: profileId, name: "Personal", color: "plum", icon: null, createdAt: 1 } },
  profileOrder: [profileId],
  windows: { [restoredId]: { id: restoredId, profileId, incognito: false, tabIds: [tabId], activeTabIds: { [profileId]: tabId }, sidebarOpen: true, frame: [12, 24, 1024, 768], createdAt: 1 } },
  windowOrder: [restoredId],
  tabs: { [tabId]: { id: tabId, windowId: restoredId, profileId, url: "", title: "", favicon: null, pinned: false, muted: false, zoom: 1, customTitle: null, customIcon: null, pinnedUrl: null, navigation: null, openerId: null, createdAt: 1, lastActiveAt: 1 } },
  focusedWindowId: restoredId,
  settings: { restoreSession: true },
};
await mkdir(`${scratch}/Default/Ardia`, { recursive: true });
await writeFile(`${scratch}/Default/Ardia/linux-session.json`, JSON.stringify(seed));
const logPath = `${scratch}/keyboard.log`;
const log = openSync(logPath, "w");
const args = [`--user-data-dir=${scratch}`, "--ozone-platform=headless", "--ozone-override-screen-size=1920,1080", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--disable-extensions", "--no-first-run", "--no-default-browser-check", "--password-store=basic", "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1", "--enable-logging=stderr", "--ardia-keyboard-diagnostics"];
if (process.argv[3]) args.push(`--ardia-ui-dir=${resolve(process.argv[3])}`);
const child = spawn(binary, args, { stdio: ["ignore", log, log], env: { ...process.env, DISPLAY: "", WAYLAND_DISPLAY: "", ARDIA_BACKGROUND: "1", ARDIA_DATA_DIR: scratch } });
closeSync(log);
let exited = false;
let spawnError;
child.once("exit", () => { exited = true; });
child.once("error", (error) => { spawnError = error; exited = true; });
const connections = [];
let browser;
let passed = false;
const until = async (test, timeout = 15000) => {
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    if (exited) throw spawnError ?? new Error(`Test browser exited; log: ${logPath}`);
    try { const result = await test(); if (result) return result; } catch (error) { last = error; }
    await delay(50);
  }
  throw new Error(`Native keyboard check timed out${last ? `: ${last.message}` : ""}; log: ${logPath}`);
};
const connect = async (url) => {
  const socket = new WebSocket(url);
  connections.push(socket);
  await Promise.race([once(socket, "open"), delay(5000).then(() => { throw new Error("DevTools connection timed out"); })]);
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  return (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 5000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
};
const evaluate = async (page, expression) => {
  const result = await page("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
try {
  const active = await until(() => readFile(`${scratch}/DevToolsActivePort`, "utf8"), 25000);
  const [port, path] = active.trim().split("\n");
  browser = await connect(`ws://127.0.0.1:${port}${path}`);
  const pages = new Map();
  const windowPage = (id) => until(async () => {
    const targets = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(2000) }).then((response) => response.json());
    for (const target of targets.filter((target) => target.url.startsWith("chrome://ardia/"))) {
      if (!pages.has(target.id)) pages.set(target.id, await connect(target.webSocketDebuggerUrl));
      const page = pages.get(target.id);
      if (await evaluate(page, `__ardiaHost.bootstrap.windowId === ${JSON.stringify(id)} && !!document.querySelector('[data-ardia-linux-window]')`)) return page;
    }
  });
  const main = await windowPage("main");
  const ids = await evaluate(main, "__ardiaHost.invoke('ArdiaShell.windowIds',{args:[]})");
  assert.ok(ids.includes("main"), `The main renderer lost its native owner: ${JSON.stringify(ids)}`);
  const restored = await windowPage(restoredId);
  assert.ok(await evaluate(restored, "!!ardiaLinux.store.getState().windows.main"), "The restored renderer started without the main window in its session");
  assert.ok((await evaluate(main, "__ardiaHost.invoke('ArdiaShell.windowIds',{args:[]})")).includes("main"), "A restored renderer closed the main native window");
  const frame = await evaluate(main, `__ardiaHost.invoke('ArdiaShell.windowFrame',{args:[${JSON.stringify(restoredId)}]})`);
  assert.deepEqual(frame, seed.windows[restoredId].frame);
  const before = await evaluate(main, "ardiaLinux.store.getState().windows.main.tabIds.length");
  await evaluate(main, `(() => {
    const send = chrome.send;
    window.heldCreation = false;
    chrome.send = (name, args) => {
      const pair = args[2]?.args;
      if (!window.heldCreation && args[1] === 'host.invoke' && args[2]?.method === 'session.write' &&
          Object.keys(pair.session.tabs ?? {}).some(id => !pair.base.tabs?.[id])) {
        window.heldCreation = true;
        setTimeout(() => send.call(chrome, name, args), 300);
        return;
      }
      return send.call(chrome, name, args);
    };
  })()`);
  await main("Page.bringToFront");
  await main("Input.dispatchKeyEvent", { type: "rawKeyDown", code: "KeyT", key: "t", windowsVirtualKeyCode: 84, modifiers: 2 });
  await main("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyT", key: "t", windowsVirtualKeyCode: 84, modifiers: 2 });
  await until(async () => await evaluate(main, "ardiaLinux.store.getState().windows.main.tabIds.length") === before + 1);
  await until(() => evaluate(main, "window.heldCreation"));
  await main("Input.dispatchKeyEvent", { type: "rawKeyDown", code: "KeyW", key: "w", windowsVirtualKeyCode: 87, modifiers: 2 });
  await main("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyW", key: "w", windowsVirtualKeyCode: 87, modifiers: 2 });
  await until(async () => await evaluate(main, "ardiaLinux.store.getState().windows.main.tabIds.length") === before);
  await delay(700);
  assert.equal(await evaluate(main, "ardiaLinux.store.getState().windows.main.tabIds.length"), before, "The pending creation save reopened the closed tab");
  const logText = await readFile(logPath, "utf8");
  assert.ok(!logText.includes("No such native window"), "Restoration invoked a native window that no longer owns its renderer");
  console.log(JSON.stringify({ nativeOwners: ids, restoredFrame: frame, newTabCount: before + 1, closedTabCount: before }));
  passed = true;
} finally {
  if (browser) await browser("Browser.close").catch(() => {});
  for (const socket of connections) socket.close();
  for (let pass = 0; !exited && pass < 100; pass++) await delay(50);
  if (!exited) {
    child.kill("SIGTERM");
    for (let pass = 0; !exited && pass < 100; pass++) await delay(50);
  }
  if (passed && exited) await rm(scratch, { recursive: true });
  else console.error(`Native keyboard evidence: ${scratch}`);
}
