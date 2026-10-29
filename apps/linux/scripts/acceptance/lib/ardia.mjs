import { spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { connectCdp, evaluate, fetchJson } from "./cdp.mjs";
import { js, until } from "./util.mjs";

export const SHELL_PREFIX = "chrome://ardia/";

const running = new Set();

export async function closeAllApps(options) {
  await Promise.all([...running].map((app) => app.close(options).catch(() => {})));
}

export function killAllAppsNow() {
  for (const app of running) {
    try { process.kill(-app.child.pid, "SIGKILL"); } catch {}
  }
}

export function launchArguments({ scratch, uiDir, ozone = "headless", screen = "1920,1080", extensions = false, extraArgs = [] }) {
  const args = [
    `--user-data-dir=${scratch}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    ...(extensions ? [] : ["--disable-extensions"]),
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,MediaRouter",
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
    "--enable-logging=stderr",
    "--v=0",
  ];
  if (ozone === "headless") args.push("--ozone-platform=headless", `--ozone-override-screen-size=${screen}`, "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader");
  else if (ozone) args.push(`--ozone-platform=${ozone}`);
  if (uiDir) args.push(`--ardia-ui-dir=${uiDir}`);
  return [...args, ...extraArgs];
}

export function launchEnvironment({ scratch, background = true, base = process.env, env = {} }) {
  const result = { ...base, ARDIA_DATA_DIR: scratch, HOME: join(scratch, "home"), XDG_CONFIG_HOME: join(scratch, "home", ".config"), XDG_CACHE_HOME: join(scratch, "home", ".cache"), XDG_DATA_HOME: join(scratch, "home", ".local", "share"), DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(scratch, "no-session-bus")}`, CUPS_SERVER: join(scratch, "no-cups-server"), DISPLAY: "", WAYLAND_DISPLAY: "", ...env };
  if (background) result.ARDIA_BACKGROUND = "1";
  else delete result.ARDIA_BACKGROUND;
  delete result.ARDIA_SWITCHES;
  delete result.ARDIA_INSTANCE;
  delete result.XDG_ACTIVATION_TOKEN;
  delete result.DESKTOP_STARTUP_ID;
  for (const [key, value] of Object.entries(result)) if (value === undefined) delete result[key];
  return result;
}

export async function launchArdia({ executable, uiDir, scratch, background = true, ozone = "headless", extensions = false, extraArgs = [], env = {}, label = "ardia", startTimeout = 45000, coreDumps = true, spawnImpl = spawn }) {
  await rm(join(scratch, "DevToolsActivePort"), { force: true });
  await mkdir(join(scratch, "home"), { recursive: true });
  const logPath = join(scratch, `${label}-${Date.now()}.log`);
  const args = launchArguments({ scratch, uiDir, ozone, extensions, extraArgs });
  const environment = launchEnvironment({ scratch, background, env });
  await writeFile(join(scratch, `${label}-command.json`), JSON.stringify({ executable, args, env: Object.fromEntries(Object.entries(env)) }, null, 2));
  const log = openSync(logPath, "w");
  const [command, commandArgs] = coreDumps ? [executable, args] : ["/bin/sh", ["-c", 'ulimit -c 0; exec "$0" "$@"', executable, ...args]];
  const child = spawnImpl(command, commandArgs, { stdio: ["ignore", log, log], env: environment, detached: true });
  closeSync(log);
  const app = new ArdiaApp({ child, scratch, logPath, label });
  running.add(app);
  child.once("exit", () => running.delete(app));
  try {
    const active = await until(() => readFile(join(scratch, "DevToolsActivePort"), "utf8").then((text) => text.includes("\n") && text), { timeout: startTimeout, label: "DevToolsActivePort", abort: () => app.exitReason() });
    const [port, path] = active.trim().split("\n");
    app.port = Number(port);
    app.browser = await connectCdp(`ws://127.0.0.1:${port}${path}`);
    return app;
  } catch (error) {
    await app.close();
    throw new Error(`${error.message}; log: ${logPath}`);
  }
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export class ArdiaApp {
  constructor({ child, scratch, logPath, label }) {
    this.child = child;
    this.scratch = scratch;
    this.logPath = logPath;
    this.label = label;
    this.connections = new Map();
    this.shellCache = new Map();
    this.exited = false;
    this.exitCode = null;
    this.spawnError = null;
    child.once("exit", (code, signal) => { this.exited = true; this.exitCode = code ?? signal; });
    child.once("error", (error) => { this.spawnError = error; this.exited = true; });
  }

  exitReason() {
    if (this.spawnError) return `could not start ${this.spawnError.message}`;
    return this.exited ? `the browser exited (${this.exitCode})` : null;
  }

  async logText() {
    return readFile(this.logPath, "utf8").catch(() => "");
  }

  async targets() {
    return fetchJson(`http://127.0.0.1:${this.port}/json/list`, 3000);
  }

  async browserTargets() {
    const { targetInfos } = await this.browser.send("Target.getTargets");
    return targetInfos;
  }

  async connect(target) {
    const existing = this.connections.get(target.id);
    if (existing && !existing.closed) return existing;
    const session = await connectCdp(target.webSocketDebuggerUrl);
    session.problems = [];
    session.on("Runtime.exceptionThrown", ({ exceptionDetails }) => session.problems.push({ kind: "exception", text: exceptionDetails?.exception?.description ?? exceptionDetails?.text }));
    session.on("Runtime.consoleAPICalled", ({ type, args }) => {
      if (type === "error" || type === "warning") session.problems.push({ kind: type, text: (args ?? []).map((a) => a.value ?? a.description ?? "").join(" ") });
    });
    session.on("Log.entryAdded", ({ entry }) => {
      if (entry?.level === "error" || entry?.level === "warning") session.problems.push({ kind: `log-${entry.level}`, text: entry.text, source: entry.source, url: entry.url ?? null });
    });
    await session.send("Runtime.enable").catch(() => {});
    await session.send("Log.enable").catch(() => {});
    this.connections.set(target.id, session);
    return session;
  }

  async disconnect(target) {
    const session = this.connections.get(target.id);
    this.connections.delete(target.id);
    await session?.close().catch(() => {});
  }

  async shells() {
    const targets = (await this.targets()).filter((t) => t.url.startsWith(SHELL_PREFIX) && t.type === "page");
    const shells = [];
    for (const target of targets) {
      const session = await this.connect(target).catch(() => null);
      if (!session) continue;
      const info = await evaluate(session, `(() => { const b = globalThis.__ardiaHost?.bootstrap; return b ? { windowId: b.windowId, profileId: b.profileId, pageProfile: b.pageProfile ?? null, startup: !!b.startup, utility: b.utility ?? null, privateWindow: !!b.privateWindow, ready: !!document.querySelector('[data-ardia-linux-window]') } : null })()`, { timeout: 3000 }).catch(() => null);
      if (!info?.windowId) continue;
      shells.push({ target, session, ...info });
    }
    return shells;
  }

  async shell(windowId, { timeout = 20000 } = {}) {
    const cached = this.shellCache.get(windowId);
    if (cached && !cached.session.closed) return cached;
    const found = await until(async () => (await this.shells()).find((s) => s.ready && (windowId === undefined || s.windowId === windowId)), { timeout, label: `shell renderer ${windowId ?? "(any)"}`, abort: () => this.exitReason() });
    const shell = new Shell(this, found);
    this.shellCache.set(found.windowId, shell);
    return shell;
  }

  async mainShell(options) {
    const shells = await until(async () => {
      const list = (await this.shells()).filter((s) => s.ready && !s.utility);
      return list.length ? list : false;
    }, { timeout: options?.timeout ?? 25000, label: "a browser shell renderer", abort: () => this.exitReason() });
    const chosen = shells.find((s) => s.startup) ?? shells.find((s) => s.windowId === "main") ?? shells[0];
    return this.shell(chosen.windowId);
  }

  async pageTarget(predicate, { timeout = 15000, label = "page target" } = {}) {
    return until(async () => (await this.targets()).find((t) => !t.url.startsWith(SHELL_PREFIX) && predicate(t)), { timeout, label, abort: () => this.exitReason() });
  }

  async pageLoaded(url, { timeout = 20000, prefix = false } = {}) {
    const matches = (candidate) => (prefix ? candidate.startsWith(url) : candidate === url);
    return until(async () => {
      const target = (await this.targets()).find((t) => t.type === "page" && matches(t.url));
      const session = target ? await connectCdp(target.webSocketDebuggerUrl).catch(() => null) : null;
      if (!session) return false;
      try {
        const href = prefix ? `location.href.startsWith(${js(url)})` : `location.href === ${js(url)}`;
        const loaded = await evaluate(session, `${href} && document.readyState === "complete"`, { timeout: 2000, userGesture: false }).catch(() => false);
        return loaded ? target : false;
      } finally {
        await session.close().catch(() => {});
      }
    }, { timeout, label: `page ${url} to load`, abort: () => this.exitReason() });
  }

  async pageSession(predicate, options) {
    return this.connect(await this.pageTarget(predicate, options));
  }

  async screenshot(session, file) {
    try {
      const { data } = await session.send("Page.captureScreenshot", { format: "png" }, { timeout: 8000 });
      await writeFile(file, Buffer.from(data, "base64"));
      return file;
    } catch {
      return null;
    }
  }

  async close({ graceful = true, timeout = 10000 } = {}) {
    if (graceful && this.browser && !this.browser.closed && !this.exited) await this.browser.send("Browser.close", {}, { timeout: 3000 }).catch(() => {});
    for (const session of this.connections.values()) await session.close().catch(() => {});
    this.connections.clear();
    this.shellCache.clear();
    await this.browser?.close().catch(() => {});
    const waitExit = async (limit) => { for (let waited = 0; !this.exited && waited < limit; waited += 50) await delay(50); };
    await waitExit(timeout);
    for (const signal of ["SIGTERM", "SIGKILL"]) {
      if (this.exited) break;
      try { process.kill(-this.child.pid, signal); } catch { try { this.child.kill(signal); } catch {} }
      await waitExit(5000);
    }
    if (this.child.pid) {
      try { process.kill(-this.child.pid, "SIGKILL"); } catch {}
      for (let waited = 0; waited < 3000 && groupAlive(this.child.pid); waited += 50) await delay(50);
    }
    return this.exited;
  }
}

export class Shell {
  constructor(app, { target, session, windowId, profileId, pageProfile, utility, privateWindow }) {
    this.app = app;
    this.target = target;
    this.session = session;
    this.windowId = windowId;
    this.profileId = profileId;
    this.pageProfile = pageProfile;
    this.utility = utility;
    this.privateWindow = privateWindow;
  }

  get problems() {
    return this.session.problems ?? [];
  }

  eval(expression, options) {
    return evaluate(this.session, expression, options);
  }

  state(body, options) {
    return this.eval(`(() => { const s = ardiaLinux.store.getState(); const windowId = ${js(this.windowId)}; ${body} })()`, options);
  }

  async waitFor(expression, { timeout = 15000, label = expression } = {}) {
    return until(() => this.eval(expression, { timeout: Math.min(timeout, 5000) }), { timeout, label, abort: () => this.app.exitReason() });
  }

  async waitState(body, options = {}) {
    return until(() => this.state(body, { timeout: 5000 }), { timeout: options.timeout ?? 15000, label: options.label ?? body, abort: () => this.app.exitReason() });
  }

  command(command, arg) {
    return this.eval(`ardiaLinux.emitCommand(${js({ command, windowId: this.windowId, ...(arg === undefined ? {} : { arg }) })}), true`);
  }

  invoke(method, args, options) {
    return this.eval(`__ardiaHost.invoke(${js(method)}, ${js(args)}).then(value => ({ ok: true, value }), error => ({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }))`, options);
  }

  call(name, args = {}, profile = "") {
    return this.eval(`__ardiaHost.call(${js(name)}, ${js(profile)}, ${js(JSON.stringify(args))}).then(value => ({ ok: true, value: JSON.parse(value) }), error => ({ ok: false, code: error?.code ?? null, message: String(error?.message ?? error) }))`);
  }

  windowIds() {
    return this.eval("__ardiaHost.invoke('ArdiaShell.windowIds', { args: [] })");
  }

  async nativeWindowId({ timeout = 15000 } = {}) {
    return until(async () => {
      const urls = await this.state("const w = s.windows[windowId]; return (w?.tabIds ?? []).map((id) => s.tabs[id]?.url).filter(Boolean);");
      for (const target of await this.app.targets()) {
        if (target.type !== "page" || !urls.includes(target.url)) continue;
        const reply = await this.app.browser.send("Browser.getWindowForTarget", { targetId: target.id }).catch(() => null);
        if (reply?.windowId) return reply.windowId;
      }
      return false;
    }, { timeout, label: `the native window of ${this.windowId}`, abort: () => this.app.exitReason() });
  }

  activeTabId() {
    return this.state("const w = s.windows[windowId]; return w ? (w.activeTabIds?.[w.profileId] ?? null) : null;");
  }

  async newTab(url) {
    const id = await this.state(`return s.newTab(windowId, { url: ${js(url)} });`);
    if (typeof id !== "string") throw new Error(`newTab returned ${JSON.stringify(id)}`);
    return id;
  }

  navigate(tabId, url) {
    return this.state(`s.navigate(${js(tabId)}, ${js(url)}); return true;`);
  }

  tab(tabId) {
    return this.state(`return s.tabs[${js(tabId)}] ?? null;`);
  }

  async waitTabUrl(tabId, test, { timeout = 20000, label } = {}) {
    return until(async () => {
      const tab = await this.tab(tabId);
      return tab && test(tab.url ?? "", tab) ? tab : false;
    }, { timeout, label: label ?? `tab ${tabId} URL`, abort: () => this.app.exitReason() });
  }

  async rect(selector) {
    return this.eval(`(() => { const nodes = [...document.querySelectorAll(${js(selector)})].filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); const n = nodes[0]; if (!n) return null; const r = n.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  }

  async rectByText(text, { exact = true } = {}) {
    return this.eval(`(() => {
      const want = ${js(text)};
      const exact = ${js(exact)};
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let best = null;
      while (walker.nextNode()) {
        const n = walker.currentNode;
        const t = (n.innerText ?? '').trim();
        if (!(exact ? t === want : t.includes(want))) continue;
        const r = n.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (!best || r.width * r.height <= best.width * best.height) best = { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
      }
      return best;
    })()`);
  }

  async mouse(x, y, { button = "left", clickCount = 1, hold = 0 } = {}) {
    await this.session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await this.session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount, buttons: button === "right" ? 2 : 1 });
    if (hold) await delay(hold);
    await this.session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount, buttons: 0 });
  }

  async click(selector, options) {
    const r = await until(() => this.rect(selector), { timeout: options?.timeout ?? 8000, label: `visible ${selector}` });
    await this.mouse(r.x, r.y, options);
    return r;
  }

  async clickText(text, options) {
    const r = await until(() => this.rectByText(text, options), { timeout: options?.timeout ?? 8000, label: `visible text ${text}` });
    await this.mouse(r.x, r.y, options);
    return r;
  }

  text() {
    return this.eval("document.body?.innerText ?? ''");
  }

  labels() {
    return this.eval("[...document.querySelectorAll('[aria-label],[title]')].filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).map(n => n.getAttribute('aria-label') ?? n.getAttribute('title'))");
  }

  async key(key, { code = key, keyCode = 0, modifiers = 0, text } = {}) {
    await this.session.send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", key, code, windowsVirtualKeyCode: keyCode, modifiers, ...(text ? { text } : {}) });
    await this.session.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: keyCode, modifiers });
  }

  insertText(text) {
    return this.session.send("Input.insertText", { text });
  }

  screenshot(file) {
    return this.app.screenshot(this.session, file);
  }
}

export const MODIFIER = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
