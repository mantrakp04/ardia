#!/usr/bin/env node
// Cross-browser benchmark: Ardia against Dia, Helium and Google Chrome on the release gate's rows that every Chromium
// browser can be measured on the same way. One harness drives all four from outside the app, over CDP, with the same
// local pages, window size, fresh profile per run and number of runs, interleaved browser by browser (A B C D, then
// rotated). Method, fairness rules and results: docs/perf/vs-browsers.md.
//
//   node apps/browser/scripts/perf/xbench.mjs run    --out <dir> [options]   measure (resumable: done items are skipped)
//   node apps/browser/scripts/perf/xbench.mjs check  --out <dir> [options]   one quick look per browser, nothing kept
//   node apps/browser/scripts/perf/xbench.mjs report --out <dir> [--json <file>] [--md <file>]
//   node apps/browser/scripts/perf/xbench.mjs clean  --out <dir>             quit leftovers, unregister the copies, delete runs
//   node apps/browser/scripts/perf/xbench.mjs signin --browsers dia --base dia=<home>   open the browser on that HOME, in
//                        view, for the owner to sign in by hand; returns when they quit it (or at --deadline)
//   node apps/browser/scripts/perf/xbench.mjs prepare-bg --browsers <a,b>    make <apps>/<name>-bg/: the copy with LSBackgroundOnly
//                        set (it can't become the active app, as Ardia's test instances can't), signed ad hoc with its
//                        entitlements and without the hardened runtime; run it as the browser <name>-bg
//
//     --browsers <a,b>     ardia,dia,helium,chrome (default: all four, in that order)
//     --apps <dir>         where the copies live (default /tmp/ac-xbench/apps): ardia/Ardia.app, dia/Dia.app,
//                          helium/Helium.app, chrome/Google Chrome.app. Never a bundle in /Applications.
//     --app <name>=<path>  repeatable: another copy for one browser (Ardia built from main, say)
//     --rounds <n>         rounds (default 3). A round is every launch, then every session, browser by browser
//     --launches <n>       launches of each kind per browser per round (default 2)
//     --rows <a,b>         link,restore,session,size (default all). session = idle, memory, newtab, switch, newwindow
//     --idle <secs>        each idle window (default 60)
//     --port <n>           the instances' CDP port (default 9461). One instance runs at a time
//     --page-port <n>      the test pages' server port (default 9462); templates restore pages from it, so keep it fixed
//     --deadline <mins>    stop starting items after this long (default 100); run again to resume
//     --gate away|off      away (default): every item waits until the owner is away (screen locked with no input for
//                          60 s, or no keyboard, mouse or trackpad input for --away secs) and is thrown away, its browser quit at once, the
//                          moment input comes. off: run now, with the Mac in use (competitors' windows show on screen)
//     --away <secs>        idle time that counts as away (default 600)
//     --window <x,y>       the windows' top-left corner (default 40,80)
//     --env <name>=K=V     repeatable: extra environment for one browser's instances (ardia=ARDIA_INSTANCE=chromiumSwitches=…)
//     --launch-tab on|off  Ardia's template session names its active tab as launchTab, as a user's session written
//                          with that kill switch on does (default on)
//     --allow-focus        record a browser making itself the active app instead of stopping (only for an A/B the
//                          owner agreed to, run while they're away)
//     --base <name>=<home> repeatable: the template starts from a copy of this HOME (a signed-in profile) instead of
//                          an empty one
//     --dmg <name>=<file|url>  repeatable: the download whose size the size row reports
//     --version-label <name>=<text>  report: show this instead of the app's version (a dev build, say)
//     --json <file>, --md <file>  report: where the results JSON and the markdown table go (default <out>/bench.json, stdout)
//
// What every instance gets: its own copy of a template profile (made once per browser by one launch that opens the
// test page, settles 90 s and quits), HOME and CFFIXED_USER_HOME pointed into it (nothing reaches the real
// ~/Library), the CDP port, and Ardia's background-mode switches for all: --disable-backgrounding-occluded-windows
// --mute-audio. Chromium browsers: --user-data-dir --no-first-run --no-default-browser-check --password-store=basic
// --use-mock-keychain --window-size --window-position. Chrome and Helium also --restore-last-session (Ardia and Dia
// restore by default). Ardia: ARDIA_BACKGROUND=1, ARDIA_DATA_DIR, ARDIA_REMOTE_DEBUGGING_PORT, onboarding done.
//
// Rows:
//   launch → page painted (link)  link     `open -a <app> <url>` with the browser closed: the URL's first-contentful-paint
//   launch → window on screen     restore  the pid's first on-screen window ≥ 300×200 with alpha > 0 (CGWindowList)
//   launch → restored tab painted restore  `open -a <app>`: the restored test page's first-contentful-paint
//   new tab → first paint         session  Target.createTarget(url) → the page's FCP (median of 5 per run)
//   tab switch → shown            session  Target.activateTarget → visibilitychange to visible + 2 rAFs (16 per run, 20 tabs)
//   new window → first paint      session  Target.createTarget(url, newWindow) → FCP, only if a new window opened (3 per run)
//   memory                        session  phys_footprint summed over every process of the instance at 1, 10, 20 tabs and 30 s
//                                           after closing back to 1
//   idle CPU, idle wakeups/s      session  rusage of every process over --idle secs, at 1 and at 20 tabs
//   download, on disk             size     the DMG's bytes; du of the bundle
// Results: <out>/samples.jsonl (one line per finished item), report → bench.json and the table.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { accessSync, appendFileSync, constants as fsConstants, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { cpus, loadavg, totalmem } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { appEnv, launchVariables, mergeLaunchEnv } from "../../../../scripts/lib/instance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "/tmp/ac-xbench/out" },
    browsers: { type: "string", default: "ardia,dia,helium,chrome" },
    apps: { type: "string", default: "/tmp/ac-xbench/apps" },
    app: { type: "string", multiple: true, default: [] },
    rounds: { type: "string", default: "3" },
    launches: { type: "string", default: "2" },
    rows: { type: "string", default: "link,restore,session,size" },
    idle: { type: "string", default: "60" },
    port: { type: "string", default: "9461" },
    "page-port": { type: "string", default: "9462" },
    deadline: { type: "string", default: "100" },
    gate: { type: "string", default: "away" },
    window: { type: "string", default: "40,80" },
    "allow-focus": { type: "boolean" },
    env: { type: "string", multiple: true, default: [] },
    "launch-tab": { type: "string", default: "on" },
    base: { type: "string", multiple: true, default: [] },
    "version-label": { type: "string", multiple: true, default: [] },
    away: { type: "string", default: "600" },
    dmg: { type: "string", multiple: true, default: [] },
    json: { type: "string" },
    md: { type: "string" },
    help: { type: "boolean", short: "h" },
  },
});
if (opt.help || !positionals[0]) {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  console.log(lines.slice(0, lines.findIndex((l) => !l.startsWith("//"))).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  process.exit(opt.help ? 0 : 64);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.error(`[xbench ${new Date().toISOString().slice(11, 19)}]`, ...a);
const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const out = resolve(opt.out);
const port = +opt.port;
const WIN = { x: +opt.window.split(",")[0], y: +opt.window.split(",")[1], w: 1280, h: 800 };
const SETTLE_TEMPLATE_MS = 90_000;

const BROWSERS = {
  ardia: { name: "Ardia", bundle: "ardia/Ardia.app", hidden: true },
  dia: { name: "Dia", bundle: "dia/Dia.app", readOnly: true, guardPrefs: true, downloadUrl: (i) => `https://releases.diabrowser.com/release/Dia-${i.version}-${i.build}.dmg` },
  helium: { name: "Helium", bundle: "helium/Helium.app", restoreSwitch: true, downloadUrl: (i) => `https://github.com/imputnet/helium-macos/releases/download/${i.version}/helium_${i.version}_arm64-macos.dmg` },
  chrome: { name: "Google Chrome", bundle: "chrome/Google Chrome.app", restoreSwitch: true, downloadUrl: () => "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg" },
};

const baseOf = (name) => name.split("-")[0];
const spec = (name) => BROWSERS[baseOf(name)];
const isArdia = (name) => baseOf(name) === "ardia";

const toolDir = join(out, ".tools");
function compiled(name, source) {
  const bin = join(toolDir, name);
  if (!existsSync(bin) || !existsSync(bin + ".src") || readFileSync(bin + ".src", "utf8") !== source) {
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(join(toolDir, `${name}.swift`), source);
    execFileSync("swiftc", ["-O", join(toolDir, `${name}.swift`), "-o", bin], { stdio: "inherit" });
    writeFileSync(bin + ".src", source);
  }
  return bin;
}
const acperfBin = () => compiled("acperf", readFileSync(join(here, "acperf.swift"), "utf8"));
const PROBE = `import AppKit
import IOKit
func hidIdle() -> Double {
  let service = IOServiceGetMatchingService(kIOMainPortDefault, IOServiceMatching("IOHIDSystem"))
  guard service != 0 else { return -1 }
  defer { IOObjectRelease(service) }
  let ns = (IORegistryEntryCreateCFProperty(service, "HIDIdleTime" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? NSNumber)?.doubleValue ?? -1e9
  return ns / 1e9
}
func state() -> [String: Any] {
  let session = CGSessionCopyCurrentDictionary() as? [String: Any]
  return ["hid": (hidIdle() * 100).rounded() / 100, "locked": (session?["CGSSessionScreenIsLocked"] as? Bool) ?? false,
          "asleep": CGDisplayIsAsleep(CGMainDisplayID()) != 0, "front": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0,
          "at": (Date().timeIntervalSince1970 * 1000).rounded()]
}
func emit(_ v: Any) {
  print(String(data: try! JSONSerialization.data(withJSONObject: v, options: [.sortedKeys]), encoding: .utf8)!)
  fflush(stdout)
}
func cover(_ pid: Int32) -> [[String: Any]] {
  guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] else { return [] }
  func rect(_ w: [String: Any]) -> CGRect {
    let b = w[kCGWindowBounds as String] as? [String: Double] ?? [:]
    return CGRect(x: b["X"] ?? 0, y: b["Y"] ?? 0, width: b["Width"] ?? 0, height: b["Height"] ?? 0)
  }
  var above: [CGRect] = []
  var result: [[String: Any]] = []
  for w in list {
    let owner = w[kCGWindowOwnerPID as String] as? Int32 ?? 0
    let r = rect(w)
    let alpha = w[kCGWindowAlpha as String] as? Double ?? 0
    if owner == pid && r.width >= 300 && r.height >= 200 && alpha > 0 {
      var covered = 0, total = 0
      for i in 0..<40 { for j in 0..<25 {
        let p = CGPoint(x: r.minX + (Double(i) + 0.5) * r.width / 40, y: r.minY + (Double(j) + 0.5) * r.height / 25)
        total += 1
        if above.contains(where: { $0.contains(p) }) { covered += 1 }
      } }
      result.append(["id": w[kCGWindowNumber as String] ?? 0, "layer": w[kCGWindowLayer as String] ?? 0, "x": r.minX, "y": r.minY,
                     "w": r.width, "h": r.height, "covered": Double(covered) / Double(total)])
    }
    if alpha > 0 && owner != pid { above.append(r) }
  }
  return result
}
let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "state": emit(state())
case "watch":
  emit(state())
  Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { _ in emit(state()) }
  RunLoop.main.run()
case "screen":
  let f = NSScreen.screens.first?.frame ?? .zero
  emit(["w": f.width, "h": f.height])
case "cover": emit(cover(Int32(args[2]) ?? 0))
default: exit(64)
}
`;
const probeBin = () => compiled("xprobe", PROBE);
const probe = (...a) => JSON.parse(execFileSync(probeBin(), a, { encoding: "utf8", timeout: 20_000 }).trim() || "null");
function acperf(...args) {
  const r = spawnSync(acperfBin(), args, { encoding: "utf8", timeout: 120_000 });
  return { code: r.status, out: (r.stdout ?? "").trim() };
}

const PAGE_SCRIPT = `
window.__ac = { vis: [[Date.now(), document.visibilityState]], shown: [], fcp: null, frame: null, ticks: 0 };
requestAnimationFrame(() => (__ac.frame = Date.now()));
new PerformanceObserver((list) => {
  for (const e of list.getEntries()) if (e.name === "first-contentful-paint") __ac.fcp = performance.timeOrigin + e.startTime;
}).observe({ type: "paint", buffered: true });
document.addEventListener("visibilitychange", () => {
  const t = Date.now();
  __ac.vis.push([t, document.visibilityState]);
  if (document.visibilityState === "visible")
    requestAnimationFrame(() => requestAnimationFrame(() => __ac.shown.push([t, Date.now()])));
});
setInterval(() => __ac.ticks++, 1000);
`;

function staticPage(id) {
  const paras = Array.from({ length: 120 }, (_, i) =>
    `<p>Paragraph ${i} of page ${id}. The quick brown fox jumps over the lazy dog; pack my box with five dozen liquor jugs. ` +
    `Sphinx of black quartz, judge my vow. <a href="#p${i}">anchor ${i}</a></p>`).join("");
  const boxes = Array.from({ length: 60 }, (_, i) =>
    `<div class=b style="background:hsl(${(i * 37 + Number(id.replace(/\D/g, "") || 0) * 11) % 360} 60% 70%)">${i}</div>`).join("");
  return `<!doctype html><meta charset=utf-8><title>Bench ${id}</title>
<style>body{font:15px/1.5 -apple-system,sans-serif;margin:0;padding:24px 48px;background:#fbfaf8;color:#222}
.g{display:grid;grid-template-columns:repeat(10,1fr);gap:8px;margin:16px 0}.b{height:48px;border-radius:10px;display:grid;place-items:center}
h1{font-size:32px}</style><h1>Bench page ${id}</h1><div class=g>${boxes}</div>${paras}<script>${PAGE_SCRIPT}</script>`;
}

let server;
const base = () => `http://127.0.0.1:${server.address().port}`;
const pageUrl = (id) => `${base()}/static?id=${id}`;
function startServer() {
  return new Promise((done) => {
    server = createServer((req, res) => {
      const url = new URL(req.url, "http://x");
      if (url.pathname !== "/static") return res.writeHead(404).end();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(staticPage(url.searchParams.get("id") ?? "0"));
    });
    server.listen(+opt["page-port"], "127.0.0.1", () => done());
  });
}

class Socket {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.pending = new Map();
    this.seq = 0;
    this.ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id) this.pending.get(msg.id)?.(msg), this.pending.delete(msg.id);
    };
    this.ready = new Promise((ok, fail) => {
      this.ws.onopen = ok;
      this.ws.onerror = () => fail(new Error(`websocket ${url} failed`));
      setTimeout(() => fail(new Error(`websocket ${url} timed out`)), 4000);
    });
  }
  async send(method, params = {}, timeout = 8000) {
    await this.ready;
    const id = ++this.seq;
    return new Promise((ok) => {
      const timer = setTimeout(() => (this.pending.delete(id), ok({ error: { message: `${method} timed out` } })), timeout);
      this.pending.set(id, (msg) => (clearTimeout(timer), ok(msg)));
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

class Cdp {
  constructor() {
    this.sockets = new Map();
  }
  async get(path) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(2500) });
      return await r.json();
    } catch {
      return null;
    }
  }
  async pages() {
    return ((await this.get("/json/list")) ?? []).filter((t) => t.type === "page");
  }
  async browser() {
    if (this.root && this.root.ws.readyState === 1) return this.root;
    const v = await this.get("/json/version");
    if (!v?.webSocketDebuggerUrl) return null;
    this.version = v;
    this.root = new Socket(v.webSocketDebuggerUrl);
    await this.root.ready;
    return this.root;
  }
  async call(method, params) {
    const b = await this.browser();
    if (!b) throw new Error("no CDP browser endpoint");
    const r = await b.send(method, params);
    if (r.error) throw new Error(`${method}: ${r.error.message}`);
    return r.result;
  }
  async state(target) {
    let s = this.sockets.get(target.id);
    if (!s || s.ws.readyState > 1) {
      s = new Socket(target.webSocketDebuggerUrl);
      this.sockets.set(target.id, s);
    }
    try {
      const r = await s.send("Runtime.evaluate", {
        expression: "JSON.stringify(Object.assign({}, window.__ac, { visibility: document.visibilityState, w: innerWidth, h: innerHeight, origin: performance.timeOrigin }))",
        returnByValue: true,
      }, 3000);
      return JSON.parse(r?.result?.result?.value ?? "null");
    } catch {
      this.sockets.delete(target.id);
      return null;
    }
  }
  async evaluate(target, expression, timeout = 3000) {
    try {
      let s = this.sockets.get(target.id);
      if (!s || s.ws.readyState > 1) this.sockets.set(target.id, (s = new Socket(target.webSocketDebuggerUrl)));
      const r = await s.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeout);
      return r?.result?.result?.value;
    } catch {
      return undefined;
    }
  }
  async find(id) {
    return (await this.pages()).find((t) => t.url.endsWith(`id=${id}`));
  }
  async page(id, timeout, accept = (s) => s.fcp) {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(20)) {
      const t = await this.find(id);
      const s = t && (await this.state(t));
      if (s && accept(s)) return { target: t, state: s };
    }
    return null;
  }
  close() {
    for (const s of this.sockets.values()) s.close();
    this.sockets.clear();
    this.root?.close();
    this.root = null;
  }
}

function processRows() {
  return execFileSync("ps", ["-axww", "-o", "pid=,ppid=,command="], { encoding: "utf8", maxBuffer: 64 << 20 })
    .split("\n").map((l) => l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/)).filter(Boolean)
    .map(([, pid, ppid, command]) => ({ pid: +pid, ppid: +ppid, command }));
}

function kindOf(command) {
  const type = command.match(/--type=(\S+)/)?.[1];
  if (!type) return /crashpad_handler/.test(command) ? "crashpad" : "browser";
  if (type === "utility") return `utility:${command.match(/--utility-sub-type=([\w.]+)/)?.[1]?.split(".")[0] ?? "?"}`;
  if (type === "renderer" && command.includes("--extension-process")) return "extension";
  return type;
}

function info(app) {
  const plist = join(app, "Contents/Info.plist");
  const read = (key) => spawnSync("plutil", ["-extract", key, "raw", plist], { encoding: "utf8" }).stdout.trim();
  const exe = join(realpathSync(app), "Contents/MacOS", read("CFBundleExecutable"));
  return { exe, version: read("CFBundleShortVersionString"), build: read("CFBundleVersion"), id: read("CFBundleIdentifier") };
}

function bundleOf(name) {
  const given = opt.app.find((a) => a.startsWith(`${name}=`));
  const app = resolve(given ? given.slice(name.length + 1) : join(opt.apps, name, basename(spec(name).bundle)));
  if (realpathSync(app).startsWith("/Applications/")) throw new Error(`${app} is in /Applications: run a copy`);
  if (!existsSync(app)) throw new Error(`no ${name} copy at ${app}`);
  return app;
}

class Gate {
  constructor() {
    this.state = null;
    this.on = opt.gate !== "off";
    this.input = 0;
  }
  start() {
    if (this.proc) return;
    this.proc = spawn(probeBin(), ["watch"], { stdio: ["ignore", "pipe", "ignore"] });
    let buf = "";
    this.proc.stdout.on("data", (d) => {
      buf += d;
      for (let i; (i = buf.indexOf("\n")) >= 0; buf = buf.slice(i + 1)) {
        try {
          const s = JSON.parse(buf.slice(0, i));
          if (this.state && s.hid < this.state.hid && s.hid < 1) this.input++;
          this.state = s;
        } catch {}
      }
    });
  }
  stop() {
    this.proc?.kill();
    this.proc = null;
  }
  away(s = this.state) {
    return !!s && !s.asleep && (s.locked ? s.hid >= 60 : s.hid >= +opt.away);
  }
  async wait(deadline) {
    if (!this.on) return true;
    for (let said = 0; Date.now() < deadline; await sleep(5000)) {
      if (this.away()) return true;
      if (Date.now() - said > 300_000) said = Date.now(), log(`waiting for the owner to be away (input ${this.state?.hid ?? "?"} s ago, locked ${this.state?.locked})`);
    }
    return false;
  }
  cond() {
    const s = this.state ?? {};
    return { locked: !!s.locked, asleep: !!s.asleep, hid: s.hid, load: Math.round(loadavg()[0] * 10) / 10 };
  }
}
const gate = new Gate();

class Aborted extends Error {}
class Fatal extends Error {}
const live = new Set();
let lockHeld = false;

class Instance {
  constructor(name, dir) {
    this.name = name;
    this.b = spec(name);
    this.app = bundleOf(name);
    this.info = info(this.app);
    this.dir = dir;
    this.home = join(dir, "home");
    this.cdp = new Cdp();
    this.inputAtStart = gate.input;
  }
  watched() {
    if (gate.on && gate.input > this.inputAtStart) throw new Aborted("the owner came back");
    if (this.pid && gate.state?.front === this.pid) {
      if (!opt["allow-focus"]) throw new Fatal(`${this.name} took focus (it became the frontmost app): stopping`);
      this.focusSeen = true;
    }
    if (this.pid && !this.alive()) throw new Error(`${this.name} (pid ${this.pid}) died`);
  }
  alive() {
    try {
      process.kill(this.pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  env() {
    const env = { HOME: this.home, CFFIXED_USER_HOME: this.home };
    if (isArdia(this.name)) {
      Object.assign(env, { ARDIA_BACKGROUND: "1", ARDIA_DATA_DIR: join(this.home, "data"), ARDIA_REMOTE_DEBUGGING_PORT: String(port),
        ...launchVariables({ instance: { updateFeed: `${base()}/appcast.xml` } }) });
    }
    const extra = opt.env.filter((e) => e.startsWith(`${this.name}=`)).map((e) => e.slice(this.name.length + 1))
      .map((e) => ({ [e.slice(0, e.indexOf("="))]: e.slice(e.indexOf("=") + 1) }));
    const merged = mergeLaunchEnv(env, ...extra);
    return isArdia(this.name) ? appEnv(this.app, merged) : merged;
  }
  args() {
    const shared = ["--no-first-run", "--no-default-browser-check", "--password-store=basic", "--disable-backgrounding-occluded-windows", "--mute-audio"];
    if (isArdia(this.name)) return [...shared, "-NSAppSleepDisabled", "YES"];
    return [`--user-data-dir=${join(this.home, "udd")}`, `--remote-debugging-port=${port}`, "--remote-allow-origins=*", ...shared,
      "--use-mock-keychain", `--window-size=${WIN.w},${WIN.h}`, `--window-position=${WIN.x},${WIN.y}`, ...(this.b.restoreSwitch ? ["--restore-last-session"] : [])];
  }
  ownPids() {
    const rows = processRows();
    const prefix = dirname(dirname(this.info.exe));
    const pids = new Set();
    const walk = (pid) => {
      for (const r of rows) if (r.ppid === pid && !pids.has(r.pid)) pids.add(r.pid), walk(r.pid);
    };
    if (this.pid && rows.some((r) => r.pid === this.pid)) pids.add(this.pid), walk(this.pid);
    for (const r of rows) if (r.command.startsWith(prefix + "/") || r.command.startsWith(prefix.replace(/^\/private/, "") + "/")) pids.add(r.pid), walk(r.pid);
    return rows.filter((r) => pids.has(r.pid)).map((r) => {
      const inTree = r.pid === this.pid || this.isDescendant(rows, r.pid);
      return { pid: r.pid, ppid: r.ppid, kind: inTree ? kindOf(r.command) : `outside:${r.command.match(/([^/]+)\.(?:app|xpc)\/Contents\/MacOS\//)?.[1] ?? basename(r.command.split(" ")[0])}`, inTree };
    });
  }
  isDescendant(rows, pid) {
    for (let p = rows.find((r) => r.pid === pid); p && p.ppid > 1; p = rows.find((r) => r.pid === p.ppid)) if (p.ppid === this.pid) return true;
    return false;
  }
  usage() {
    const procs = this.ownPids();
    const byPid = new Map(procs.map((p) => [p.pid, p]));
    const lines = procs.length ? acperf("rusage", ...procs.map((p) => String(p.pid))).out.split("\n").filter(Boolean) : [];
    return lines.map((l) => JSON.parse(l)).map((u) => ({ ...u, kind: byPid.get(u.pid)?.kind, inTree: byPid.get(u.pid)?.inTree }));
  }
  footprint() {
    const kinds = {};
    let total = 0;
    const snap = this.usage();
    for (const u of snap) {
      kinds[u.kind] = (kinds[u.kind] ?? 0) + u.footprint / 1048576;
      total += u.footprint / 1048576;
    }
    const renderers = snap.filter((u) => u.kind === "renderer" || u.kind === "extension").map((u) => ({ pid: u.pid, kind: u.kind, mb: Math.round((u.footprint / 1048576) * 10) / 10 }));
    return { totalMB: total, processes: snap.length, outsideTree: snap.filter((u) => !u.inTree).length, kinds, renderers };
  }
  async launch(url) {
    if (spawnSync("pgrep", ["-f", `^${this.info.exe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`]).status === 0) throw new Error(`a ${this.name} instance is still running`);
    if ((await this.cdp.get("/json/version"))) throw new Error(`port ${port} is already taken`);
    if (this.b.readOnly) {
      let writable = true;
      try {
        accessSync(join(this.app, "Contents"), fsConstants.W_OK);
      } catch {
        writable = false;
      }
      if (writable) throw new Error(`${this.name}'s copy is writable: chmod -R a-w it so it can't update itself`);
    }
    if (this.b.guardPrefs) this.prefs = new PrefsGuard(this.info.id).save();
    const env = this.env();
    const argv = ["-g", "-n", ...Object.entries(env).flatMap(([k, v]) => ["--env", `${k}=${v}`]), "-a", this.app, ...(url ? [url] : []), "--args", ...this.args()];
    this.front = probe("state").front;
    this.t0 = Date.now();
    execFileSync("open", argv);
    const main = `^${this.info.exe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`;
    for (let i = 0; i < 1000 && !this.pid; i++) {
      const r = spawnSync("pgrep", ["-f", main], { encoding: "utf8" });
      if (r.status === 0) this.pid = +r.stdout.trim().split("\n")[0];
      else await sleep(5);
    }
    if (!this.pid) throw new Error(`${this.name} didn't start`);
    live.add(this);
    this.window = new Promise((done) => {
      const p = spawn(acperfBin(), ["waitwindow", String(this.pid), "60"], { stdio: ["ignore", "pipe", "ignore"] });
      let said = "";
      p.stdout.on("data", (d) => (said += d));
      p.on("close", (code) => done(code === 0 ? +said.trim() : NaN));
    });
    return this;
  }
  async ready(timeout = 60_000) {
    for (const end = Date.now() + timeout; Date.now() < end; await sleep(50)) {
      this.watched();
      if (await this.cdp.browser().catch(() => null)) return this.cdp.version;
    }
    throw new Error(`${this.name}: no CDP endpoint on ${port}`);
  }
  async page(id, timeout = 30_000, accept) {
    for (const end = Date.now() + timeout; Date.now() < end; ) {
      this.watched();
      const r = await this.cdp.page(id, Math.min(1000, end - Date.now()), accept);
      if (r) return r;
    }
    return null;
  }
  async hold(ms) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(Math.min(250, end - Date.now()))) this.watched();
  }
  focusTaken() {
    const now = probe("state").front;
    return now !== this.front && this.ownPids().some((p) => p.pid === now) ? now : 0;
  }
  async quit() {
    const pids = () => this.ownPids().map((p) => p.pid);
    let left = pids();
    if (left.length) {
      await this.cdp.call("Browser.close").catch(() => null);
      for (const end = Date.now() + 15_000; Date.now() < end && (left = pids()).length; ) await sleep(200);
      for (const p of left) try {
        process.kill(p, "SIGTERM");
      } catch {}
      for (const end = Date.now() + 5000; Date.now() < end && (left = pids()).length; ) await sleep(200);
      for (const p of left) try {
        process.kill(p, "SIGKILL");
      } catch {}
    }
    this.cdp.close();
    for (const end = Date.now() + 10_000; Date.now() < end && (await this.cdp.get("/json/version")); ) await sleep(200);
    this.prefs?.restore();
    live.delete(this);
    if (info(this.app).version !== this.info.version) throw new Fatal(`${this.name}'s copy changed version (${this.info.version} → ${info(this.app).version}): it updated itself`);
  }
}

const templateDir = (name) => join(out, "templates", name);

class PrefsGuard {
  constructor(domain) {
    this.domain = domain;
    this.dir = join(out, "prefs-guard");
    this.file = join(this.dir, `${domain}.plist`);
  }
  save() {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.existed = existsSync(join(process.env.HOME, "Library/Preferences", `${this.domain}.plist`));
    if (this.existed) {
      rmSync(this.file, { force: true });
      execFileSync("sh", ["-c", 'umask 077 && exec defaults export "$0" "$1"', this.domain, this.file]);
      const first = join(this.dir, `${this.domain}.first.plist`);
      if (!existsSync(first)) execFileSync("cp", ["-p", this.file, first]);
    }
    return this;
  }
  restore() {
    spawnSync("defaults", ["delete", this.domain], { stdio: "ignore" });
    if (this.existed) execFileSync("defaults", ["import", this.domain, this.file]);
    rmSync(this.file, { force: true });
  }
}

async function makeTemplate(name) {
  const dir = templateDir(name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const baseHome = opt.base.find((b) => b.startsWith(`${name}=`))?.slice(name.length + 1);
  if (baseHome) execFileSync("cp", ["-Rc", resolve(baseHome), join(dir, "home")]);
  else mkdirSync(join(dir, "home"), { recursive: true });
  if (isArdia(name)) {
    mkdirSync(join(dir, "home/data"), { recursive: true });
    writeFileSync(join(dir, "home/data/onboarding.json"), JSON.stringify({ version: 1, completedAt: 1 }));
  }
  log(`making ${name}'s template profile`);
  const app = await new Instance(name, dir).launch(null);
  let version;
  try {
    version = await app.ready();
    await app.hold(3000);
    await app.cdp.call("Target.createTarget", { url: pageUrl("seed") });
    if (!(await app.page("seed", 30_000))) throw new Error(`${name}: the template's page never painted`);
    for (const t of await app.cdp.pages()) if (!t.url.endsWith("id=seed")) await app.cdp.call("Target.closeTarget", { targetId: t.id }).catch(() => null);
    await app.hold(Math.max(0, app.t0 + SETTLE_TEMPLATE_MS - Date.now()));
    const left = (await app.cdp.pages()).map((t) => t.url);
    writeFileSync(join(dir, "template.json"), JSON.stringify({ made: new Date().toISOString(), browser: version.Browser, userAgent: version["User-Agent"], pages: left, info: app.info }, null, 2));
  } finally {
    await app.quit();
  }
  if (isArdia(name)) fixArdiaSession(join(dir, "home/data/session.json"));
  for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) rmSync(join(dir, "home/udd", f), { force: true });
  log(`${name} template: ${version.Browser}`);
}

function fixArdiaSession(file) {
  const session = JSON.parse(readFileSync(file, "utf8"));
  const { h } = probe("screen");
  const blank = new Set(session.tabs.filter((t) => !t.url).map((t) => t.id));
  const seed = session.tabs.find((t) => t.url.endsWith("id=seed"));
  if (seed && opt["launch-tab"] === "on") session.launchTab = { id: seed.id, url: seed.url, profile: seed.profileId === "default" ? "" : seed.profileId };
  if (blank.size < session.tabs.length) session.tabs = session.tabs.filter((t) => !blank.has(t.id));
  for (const w of session.windows ?? []) {
    w.tabIds = w.tabIds.filter((id) => session.tabs.some((t) => t.id === id));
    if (!w.kind) w.frame = [WIN.x, h - WIN.y - WIN.h, WIN.w, WIN.h];
  }
  writeFileSync(file, JSON.stringify(session));
}

function runDir(item) {
  const dir = join(out, "runs", item.replaceAll("/", "-"));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync("cp", ["-Rc", templateDir(item.split("/")[2]), dir]);
  return dir;
}

async function launchItem(name, item, kind) {
  const dir = runDir(item);
  const app = new Instance(name, dir);
  const linkId = item.replaceAll("/", "-");
  try {
    await app.launch(kind === "link" ? pageUrl(linkId) : null);
    const page = await app.page(kind === "link" ? linkId : "seed", kind === "link" ? 30_000 : 15_000);
    const windowAt = await app.window;
    const r = {
      window: windowAt - app.t0,
      firstPaint: (page?.state.fcp ?? NaN) - app.t0,
      firstFrame: (page?.state.frame ?? NaN) - app.t0,
      navigationStart: (page?.state.origin ?? NaN) - app.t0,
      visibleAt: (page?.state.vis?.find(([, v]) => v === "visible")?.[0] ?? NaN) - app.t0,
      viewport: page ? [page.state.w, page.state.h] : null,
      pages: (await app.cdp.pages()).length,
      focusTaken: app.focusTaken() || !!app.focusSeen,
    };
    await app.hold(1500);
    return r;
  } finally {
    await app.quit();
    keepLogs(item, dir);
    rmSync(dir, { recursive: true, force: true });
  }
}

const STEADY_MS = 120_000;

function keepLogs(item, dir) {
  const log = join(dir, "home/data/Chromium/chrome_debug.log");
  if (!existsSync(log)) return;
  mkdirSync(join(out, "logs"), { recursive: true });
  execFileSync("cp", [log, join(out, "logs", `${item.replaceAll("/", "-")}.chrome_debug.log`)]);
}

async function throttled(app) {
  for (const t of await app.cdp.pages()) {
    const frames = await app.cdp.evaluate(t, `document.visibilityState !== "visible" ? -1 : new Promise((done) => { let n = 0; const t0 = performance.now();
      (function f() { n++; if (performance.now() - t0 < 250) requestAnimationFrame(f); else done(n); })(); })`);
    if (typeof frames === "number" && frames >= 0) return frames < 5;
  }
  return null;
}

function usageDelta(a, b) {
  const before = new Map(a.map((u) => [u.pid, u]));
  const kinds = {};
  const total = { cpu: 0, wakeups: 0 };
  for (const u of b) {
    const p = before.get(u.pid);
    if (!p) continue;
    const secs = (u.at - p.at) / 1000;
    const cpu = ((u.cpuNs - p.cpuNs) / 1e9 / secs) * 100;
    const wakeups = (u.idleWakeups + u.interruptWakeups - p.idleWakeups - p.interruptWakeups) / secs;
    const k = (kinds[u.kind] ??= { cpu: 0, wakeups: 0, count: 0 });
    k.cpu += cpu;
    k.wakeups += wakeups;
    k.count++;
    total.cpu += cpu;
    total.wakeups += wakeups;
  }
  return { total, kinds, processes: b.length };
}

async function idleWindow(app, secs) {
  const a = app.usage();
  const cover = probe("cover", String(app.pid));
  await app.hold(secs * 1000);
  const b = app.usage();
  return { ...usageDelta(a, b), cover };
}

async function openTab(app, id) {
  const at = Date.now();
  const { targetId } = await app.cdp.call("Target.createTarget", { url: pageUrl(id) });
  const p = await app.page(id, 30_000);
  return { targetId, at, page: p };
}

async function sessionItem(name, item) {
  const dir = runDir(item);
  const app = new Instance(name, dir);
  const secs = +opt.idle;
  const r = { memory: {}, idle: {}, tabSwitch: [], newTab: [], newTabFrame: [], newWindow: [], newWindowOpened: [], throttled: { tabSwitch: 0, newTab: 0 } };
  try {
    await app.launch(null);
    await app.ready();
    let seed = await app.page("seed", 15_000);
    if (!seed) {
      const target = await app.cdp.find("seed");
      if (target) await app.cdp.call("Target.activateTarget", { targetId: target.id }).catch(() => null);
      seed = await app.page("seed", 30_000);
      r.seedShownByActivate = true;
    }
    if (!seed) throw new Error(`${name}: the restored page never painted, even activated`);
    r.focusTaken = app.focusTaken();
    const seedAt = Date.now();
    await app.hold(30_000);
    r.idle.tabs1 = await idleWindow(app, secs);
    r.memory.tabs1 = app.footprint();
    await app.hold(Math.max(0, seedAt + STEADY_MS - Date.now()));
    r.idle.tabs1steady = await idleWindow(app, secs);
    const tabs = [];
    for (let i = 1; i < 10; i++) tabs.push(await openTab(app, `t${i}`));
    await app.hold(10_000);
    r.memory.tabs10 = app.footprint();
    for (let i = 10; i < 20; i++) tabs.push(await openTab(app, `t${i}`));
    const loadedAt = Date.now();
    await app.hold(15_000);
    r.memory.tabs20 = app.footprint();
    r.idle.tabs20 = await idleWindow(app, secs);
    await app.hold(Math.max(0, loadedAt + STEADY_MS - Date.now()));
    r.idle.tabs20steady = await idleWindow(app, secs);
    r.memory.tabs20steady = app.footprint();
    r.pagesAt20 = (await app.cdp.pages()).length;

    for (let k = 0; k < 16; k++) {
      const tab = tabs[(k * 7 + 3) % tabs.length];
      const id = `t${(k * 7 + 3) % tabs.length + 1}`;
      const target = await app.cdp.find(id);
      const before = (await app.cdp.state(target))?.shown?.length ?? 0;
      const hidden = await throttled(app);
      const at = Date.now();
      await app.cdp.call("Target.activateTarget", { targetId: tab.targetId });
      const s = await app.page(id, 5000, (st) => (st.shown?.length ?? 0) > before);
      const shown = s?.state.shown.at(-1);
      if (hidden) r.throttled.tabSwitch++;
      r.tabSwitch.push(shown && !hidden ? shown[1] - at : NaN);
      await app.hold(400);
    }

    for (let k = 0; k < 5; k++) {
      const hidden = await throttled(app);
      const t = await openTab(app, `n${k}`);
      if (hidden) r.throttled.newTab++;
      r.newTab.push(t.page && !hidden ? t.page.state.fcp - t.at : NaN);
      r.newTabFrame.push(t.page?.state.frame && !hidden ? t.page.state.frame - t.at : NaN);
      await app.hold(800);
      await app.cdp.call("Target.closeTarget", { targetId: t.targetId }).catch(() => null);
      await app.hold(400);
    }

    const mainWindow = (await app.cdp.call("Browser.getWindowForTarget", { targetId: seed.target.id }).catch(() => null))?.windowId;
    for (let k = 0; k < 3; k++) {
      const at = Date.now();
      const { targetId } = await app.cdp.call("Target.createTarget", { url: pageUrl(`w${k}`), newWindow: true });
      const p = await app.page(`w${k}`, 20_000);
      const win = (await app.cdp.call("Browser.getWindowForTarget", { targetId }).catch(() => null))?.windowId;
      const opened = !!win && win !== mainWindow;
      r.newWindowOpened.push(opened);
      r.newWindow.push(p && opened ? p.state.fcp - at : NaN);
      await app.hold(1000);
      await app.cdp.call("Target.closeTarget", { targetId }).catch(() => null);
      await app.hold(1500);
    }

    await app.cdp.call("Target.activateTarget", { targetId: seed.target.id }).catch(() => null);
    for (const t of await app.cdp.pages()) if (!t.url.endsWith("id=seed")) await app.cdp.call("Target.closeTarget", { targetId: t.id }).catch(() => null);
    await app.hold(30_000);
    r.memory.closed = app.footprint();
    r.focusTaken = r.focusTaken || !!app.focusSeen;
    r.pagesClosed = (await app.cdp.pages()).length;
  } finally {
    await app.quit();
    keepLogs(item, dir);
    rmSync(dir, { recursive: true, force: true });
  }
  return r;
}

function du(path) {
  return +execFileSync("du", ["-sk", path], { encoding: "utf8" }).split("\t")[0] * 1024;
}

async function sizeItem(name) {
  const app = bundleOf(name);
  const i = info(app);
  const given = opt.dmg.find((d) => d.startsWith(`${name}=`))?.slice(name.length + 1);
  const local = isArdia(name) ? join(repoRoot, `dist/${i.version}/Ardia-${i.version}.dmg`) : null;
  const source = given ?? (local && existsSync(local) ? local : spec(name).downloadUrl?.(i));
  let download = NaN;
  if (source && /^https?:/.test(source)) {
    const r = spawnSync("curl", ["-sIL", "--max-time", "30", source], { encoding: "utf8" });
    const ok = [...r.stdout.matchAll(/^HTTP\/[\d.]+ (\d+)/gm)].at(-1)?.[1] === "200";
    download = ok ? +[...r.stdout.matchAll(/^content-length: *(\d+)/gim)].at(-1)?.[1] : NaN;
  } else if (source && existsSync(source)) download = statSync(source).size;
  return { download, bundle: du(app), source, archs: execFileSync("lipo", ["-archs", i.exe], { encoding: "utf8" }).trim() };
}

function readSamples() {
  const file = join(out, "samples.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const record = (sample) => appendFileSync(join(out, "samples.jsonl"), JSON.stringify(sample) + "\n");

function plan(names) {
  const rows = new Set(opt.rows.split(","));
  const items = [];
  for (let r = 0; r < +opt.rounds; r++) {
    const order = names.map((_, i) => names[(i + r) % names.length]);
    for (const kind of ["link", "restore"])
      if (rows.has(kind)) for (let k = 0; k < +opt.launches; k++) for (const n of order) items.push({ key: `r${r}/${kind}${k}/${n}`, round: r, kind, browser: n });
    if (rows.has("session")) for (const n of order) items.push({ key: `r${r}/session/${n}`, round: r, kind: "session", browser: n });
  }
  return items;
}

const ESTIMATE_MS = { link: 25_000, restore: 25_000, session: 5 * 60_000 + 4 * +opt.idle * 1000 };

const lockOwner = `xbench-${process.pid}`;
function takeLock() {
  const r = spawnSync(join(repoRoot, "scripts/agent/locked"), ["perflab", "--take", lockOwner, "--ttl", "30", "--wait", "120"], { encoding: "utf8" });
  lockHeld = r.status === 0;
  return lockHeld;
}
const releaseLock = () => {
  lockHeld = false;
  return spawnSync(join(repoRoot, "scripts/agent/locked"), ["perflab", "--release", lockOwner], { encoding: "utf8" });
};

async function run(names) {
  const deadline = Date.now() + +opt.deadline * 60_000;
  const rows = new Set(opt.rows.split(","));
  mkdirSync(out, { recursive: true });
  const done = new Set(readSamples().filter((s) => s.ok).map((s) => s.key));
  if (rows.has("size")) for (const n of names) if (!done.has(`size/${n}`)) record({ key: `size/${n}`, kind: "size", browser: n, ok: true, at: new Date().toISOString(), ...(await sizeItem(n)) });
  const items = plan(names).filter((i) => !done.has(i.key));
  log(`${items.length} items to run (${done.size} done)`);
  gate.start();
  await sleep(500);
  let locked = false;
  try {
    for (const item of items) {
      if (Date.now() + ESTIMATE_MS[item.kind] > deadline) {
        log("deadline: stopping; run again to resume");
        break;
      }
      let waited = true;
      for (;;) {
        if (!(waited = await gate.wait(deadline - ESTIMATE_MS[item.kind]))) break;
        if (!(locked = takeLock())) {
          log("perflab is busy; waiting");
          await sleep(30_000);
          continue;
        }
        if (!existsSync(join(templateDir(item.browser), "template.json"))) {
          try {
            await makeTemplate(item.browser);
          } catch (e) {
            if (e instanceof Fatal) throw e;
            log(`template of ${item.browser} ${e instanceof Aborted ? "thrown away" : "failed"}: ${e.message}`);
            if (e instanceof Aborted) continue;
            break;
          }
        }
        const cond = gate.cond();
        const started = Date.now();
        try {
          const data = item.kind === "session" ? await sessionItem(item.browser, item.key) : await launchItem(item.browser, item.key, item.kind);
          const sample = { ...item, ok: true, at: new Date(started).toISOString(), cond, condAfter: gate.cond(), ...data };
          record(sample);
          log(`${item.key}:`, JSON.stringify(summaryLine(sample)));
          await sleep(3000);
          break;
        } catch (e) {
          if (e instanceof Fatal) throw e;
          record({ ...item, ok: false, at: new Date(started).toISOString(), [e instanceof Aborted ? "aborted" : "failed"]: e.message });
          log(`${item.key} ${e instanceof Aborted ? "thrown away" : "failed (retried on the next run)"}: ${e.message}`);
          if (!(e instanceof Aborted)) break;
          if (locked) releaseLock(), (locked = false);
        }
      }
      if (!waited) {
        log("deadline while waiting for the owner to be away; run again to resume");
        break;
      }
      if (gate.on && !gate.away() && locked) releaseLock(), (locked = false);
    }
  } finally {
    gate.stop();
    if (locked) releaseLock();
  }
  const left = plan(names).filter((i) => !new Set(readSamples().filter((s) => s.ok).map((s) => s.key)).has(i.key)).length;
  log(left ? `${left} items left` : "all items done");
  return left;
}

function summaryLine(s) {
  if (s.kind !== "session") return { window: Math.round(s.window), paint: Math.round(s.firstPaint), pages: s.pages, focus: s.focusTaken };
  return {
    idle1: [s.idle.tabs1.total.cpu.toFixed(2), s.idle.tabs1.total.wakeups.toFixed(1)],
    idle20: [s.idle.tabs20.total.cpu.toFixed(2), s.idle.tabs20.total.wakeups.toFixed(1)],
    mem: [s.memory.tabs1, s.memory.tabs10, s.memory.tabs20, s.memory.closed].map((m) => Math.round(m.totalMB)),
    sw: Math.round(median(s.tabSwitch)), nt: Math.round(median(s.newTab)), nw: s.newWindow.map(Math.round), opened: s.newWindowOpened,
  };
}

const prefsStamp = (name) => {
  const file = join(process.env.HOME, "Library/Preferences", `${info(bundleOf(name)).id}.plist`);
  return existsSync(file) ? statSync(file).mtimeMs : null;
};

async function check(names) {
  const deadline = Date.now() + +opt.deadline * 60_000;
  gate.start();
  await sleep(500);
  try {
    for (const name of names) {
      if (!(await gate.wait(deadline))) throw new Error("the owner wasn't away before the deadline");
      const dir = join(out, "check", name);
      rmSync(dir, { recursive: true, force: true });
      const baseHome = opt.base.find((b) => b.startsWith(`${name}=`))?.slice(name.length + 1);
      mkdirSync(baseHome ? dir : join(dir, "home"), { recursive: true });
      if (baseHome) execFileSync("cp", ["-Rc", resolve(baseHome), join(dir, "home")]);
      if (isArdia(name)) mkdirSync(join(dir, "home/data"), { recursive: true }), writeFileSync(join(dir, "home/data/onboarding.json"), JSON.stringify({ version: 1, completedAt: 1 }));
      const app = new Instance(name, dir);
      const report = { name, version: app.info.version, window: opt.window };
      const prefs = prefsStamp(name);
      const jobs = () => spawnSync("launchctl", ["list"], { encoding: "utf8" }).stdout.split("\n").filter((l) => /google|keystone|helium|thebrowser/i.test(l)).map((l) => l.split("\t").at(-1));
      const jobsBefore = jobs();
      try {
        await app.launch(pageUrl("check"));
        report.cdp = (await app.ready()).Browser;
        const p = await app.page("check", 30_000);
        report.linkPaint = p ? Math.round(p.state.fcp - app.t0) : null;
        report.viewport = p ? [p.state.w, p.state.h] : null;
        report.windowAt = (await app.window) - app.t0;
        await app.hold(4000);
        report.targets = ((await app.cdp.get("/json/list")) ?? []).map((t) => `${t.type} ${t.url.slice(0, 90)}`);
        const t = await openTab(app, "check-nt");
        report.newTab = t.page ? Math.round(t.page.state.fcp - t.at) : null;
        report.newTabVisibility = t.page?.state.visibility ?? (await app.cdp.state(await app.cdp.find("check-nt")))?.visibility;
        report.cover = probe("cover", String(app.pid));
        report.focusTaken = app.focusTaken();
        report.processes = app.ownPids().map((p) => `${p.kind}${p.inTree ? "" : " (outside the tree)"}`);
        report.uddUsed = isArdia(name) ? existsSync(join(app.home, "data/Chromium/Default")) : existsSync(join(app.home, "udd/Default")) || existsSync(join(app.home, "udd/User Data/Default"));
        report.homeLibrary = existsSync(join(app.home, "Library")) ? readdirSync(join(app.home, "Library")) : [];
      } catch (e) {
        report.error = e.message;
      } finally {
        await app.quit().catch((e) => (report.quitError = e.message));
        report.realPrefsWritten = prefsStamp(name) !== prefs;
        report.newLaunchdJobs = jobs().filter((j) => !jobsBefore.includes(j));
      }
      console.log(JSON.stringify(report, null, 2));
      rmSync(dir, { recursive: true, force: true });
      if (/took focus|updated itself/.test(`${report.error} ${report.quitError}`)) throw new Error(`${name}: ${report.error ?? report.quitError}; stopping the check`);
    }
  } finally {
    gate.stop();
  }
}

const ROWS = [
  { id: "launch-link", label: "Cold launch → page painted (link opened from another app)", unit: "ms", lowerIsBetter: true, kind: "link", get: (s) => s.firstPaint },
  { id: "launch-window", label: "Cold launch → window on screen", unit: "ms", lowerIsBetter: true, kind: "restore", get: (s) => s.window },
  { id: "launch-restore", label: "Cold launch → restored tab painted", unit: "ms", lowerIsBetter: true, kind: "restore", get: (s) => s.firstPaint },
  { id: "newtab", label: "New tab → first paint", unit: "ms", lowerIsBetter: true, kind: "session", get: (s) => median(s.newTab) },
  { id: "switch", label: "Tab switch → shown", unit: "ms", lowerIsBetter: true, kind: "session", get: (s) => median(s.tabSwitch) },
  { id: "newwindow", label: "New window → first paint", unit: "ms", lowerIsBetter: true, kind: "session", get: (s) => median(s.newWindow) },
  { id: "memory-1", label: "Memory, 1 tab", unit: "MB", lowerIsBetter: true, kind: "session", get: (s) => s.memory.tabs1.totalMB },
  { id: "memory-10", label: "Memory, 10 tabs", unit: "MB", lowerIsBetter: true, kind: "session", get: (s) => s.memory.tabs10.totalMB },
  { id: "memory-20", label: "Memory, 20 tabs", unit: "MB", lowerIsBetter: true, kind: "session", get: (s) => s.memory.tabs20.totalMB },
  { id: "memory-closed", label: "Memory, back to 1 tab after 20", unit: "MB", lowerIsBetter: true, kind: "session", get: (s) => s.memory.closed.totalMB },
  { id: "idle-cpu-1", label: "Idle CPU, 1 tab", unit: "%", lowerIsBetter: true, kind: "session", get: (s) => s.idle.tabs1.total.cpu },
  { id: "idle-cpu-20", label: "Idle CPU, 20 tabs", unit: "%", lowerIsBetter: true, kind: "session", get: (s) => s.idle.tabs20.total.cpu },
  { id: "idle-wakeups-1", label: "Idle wakeups, 1 tab", unit: "/s", lowerIsBetter: true, kind: "session", get: (s) => s.idle.tabs1.total.wakeups },
  { id: "idle-wakeups-20", label: "Idle wakeups, 20 tabs", unit: "/s", lowerIsBetter: true, kind: "session", get: (s) => s.idle.tabs20.total.wakeups },
  { id: "idle-cpu-1-steady", label: "Idle CPU, 1 tab, settled (2 min after load)", unit: "%", lowerIsBetter: true, kind: "session", get: (s) => s.idle.tabs1steady?.total.cpu },
  { id: "idle-cpu-20-steady", label: "Idle CPU, 20 tabs, settled (2 min after the last load)", unit: "%", lowerIsBetter: true, kind: "session", get: (s) => s.idle.tabs20steady?.total.cpu },
  { id: "idle-wakeups-1-steady", label: "Idle wakeups, 1 tab, settled", unit: "/s", lowerIsBetter: true, kind: "session", get: (s) => s.idle.tabs1steady?.total.wakeups },
  { id: "idle-wakeups-20-steady", label: "Idle wakeups, 20 tabs, settled", unit: "/s", lowerIsBetter: true, kind: "session", get: (s) => s.idle.tabs20steady?.total.wakeups },
  { id: "download", label: "Download (DMG)", unit: "MB", lowerIsBetter: true, kind: "size", context: true, get: (s) => s.download / 1e6 },
  { id: "on-disk", label: "App on disk", unit: "MB", lowerIsBetter: true, kind: "size", context: true, get: (s) => s.bundle / 1e6 },
];

function machine() {
  const hw = execFileSync("system_profiler", ["SPHardwareDataType"], { encoding: "utf8" });
  const field = (k) => hw.match(new RegExp(`${k}: (.+)`))?.[1]?.trim();
  return {
    model: `${field("Model Name")} (${field("Model Identifier")})`,
    chip: field("Chip"),
    cores: cpus().length,
    ram: `${Math.round(totalmem() / 2 ** 30)} GB`,
    macOS: `${execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()} (${execFileSync("sw_vers", ["-buildVersion"], { encoding: "utf8" }).trim()})`,
  };
}

function report(names) {
  const samples = readSamples().filter((s) => s.ok);
  const browsers = {};
  for (const n of names) {
    const t = existsSync(join(templateDir(n), "template.json")) ? JSON.parse(readFileSync(join(templateDir(n), "template.json"), "utf8")) : null;
    const app = bundleOf(n);
    const label = opt["version-label"].find((v) => v.startsWith(`${n}=`))?.slice(n.length + 1);
    browsers[n] = { name: spec(n).name, version: label ?? info(app).version, chromium: chromiumOf(app, t) };
    if (n !== baseOf(n)) browsers[n].variant = n.endsWith("-bg") ? "background-only copy (LSBackgroundOnly, ad hoc signed)" : n.slice(baseOf(n).length + 1);
  }
  const rows = ROWS.map((row) => {
    const per = {};
    for (const n of names) {
      const xs = samples.filter((s) => s.browser === n && s.kind === row.kind).map(row.get).filter(Number.isFinite);
      per[n] = { ...browsers[n], median: round(median(xs)), min: round(Math.min(...xs)), max: round(Math.max(...xs)), n: xs.length };
      if (!xs.length) Object.assign(per[n], { median: null, min: null, max: null });
    }
    return { id: row.id, label: row.label, unit: row.unit, lowerIsBetter: row.lowerIsBetter, ...(row.context ? { context: true } : {}), browsers: per };
  }).filter((row) => Object.values(row.browsers).some((b) => b.n));
  const result = {
    date: new Date().toISOString().slice(0, 10),
    machine: machine(),
    browsers,
    rows,
    method: "docs/perf/vs-browsers.md",
    notes: NOTES,
  };
  for (const row of result.rows) {
    const ranked = Object.entries(row.browsers).filter(([, b]) => b.median !== null).sort((a, b) => (row.lowerIsBetter ? a[1].median - b[1].median : b[1].median - a[1].median));
    row.best = ranked[0]?.[0] ?? null;
    if (row.id === "launch-restore") for (const [n, b] of Object.entries(row.browsers)) if (b.median === null && baseOf(n) === "dia") b.note = "Dia opens on its start view at launch; the restored tab stays hidden until it's chosen, so it never paints on its own";
    if (row.id === "newwindow") for (const [n, b] of Object.entries(row.browsers)) if (b.median === null) b.note = "Target.createTarget with newWindow opens a tab in the current window, not a new window";
  }
  return result;
}

function chromiumOf(app, template) {
  const fromCdp = template?.browser?.match(/\/(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (fromCdp) return fromCdp;
  for (const fw of readdirSync(join(app, "Contents/Frameworks")).filter((f) => f.endsWith(".framework"))) {
    const versions = existsSync(join(app, "Contents/Frameworks", fw, "Versions")) ? readdirSync(join(app, "Contents/Frameworks", fw, "Versions")) : [];
    const dotted = versions.find((v) => /^\d+\.\d+\.\d+\.\d+$/.test(v));
    if (dotted) return dotted;
  }
  const arc = join(app, "Contents/Frameworks/ArcCore.framework/Resources/Info.plist");
  return existsSync(arc) ? spawnSync("plutil", ["-extract", "CFBundleShortVersionString", "raw", arc], { encoding: "utf8" }).stdout.trim() : null;
}

const NOTES = [
  "One harness drives all four from outside the app over CDP, the same local test pages served from 127.0.0.1, one instance at a time, browsers interleaved per run and rotated each round.",
  "Every run starts from its own copy of a template profile made once per browser (one launch, the test page open, 90 s to settle, quit), with HOME pointed into it; default settings, built-in ad blockers as shipped.",
  "Chrome and Helium get --restore-last-session so all four restore the same one-tab session (Ardia and Dia restore by default).",
  "Window 1280×800 at the same place for every browser that takes --window-size; Ardia's window frame is set in its session to the same size; Dia ignores --window-size and opens full-screen-sized (1512×949).",
  "Chrome and Helium run as shipped: they bring themselves to the front at launch and on a tab switch, and fetch their Finch (variations) seed and components as usual. Dia runs in view without taking focus, signed in with a throwaway account. Ardia runs in its background test mode: it can't become the active app, its windows sit behind the owner's and report themselves as not occluded, and App Nap is off for it.",
  "Memory is phys_footprint summed over every process of the browser (app, helpers, GPU, renderers, utilities, anything running from its bundle); CPU and wakeups are rusage over the same processes.",
  "Measured on the owner's working Mac, in normal use: browsers interleaved run by run and rotated each round so the owner's activity falls on all of them alike; each figure is the median of the runs, with min–max and n.",
  "Median, min–max and n over runs; a row is a win when the ranges don't overlap.",
];

const round = (x) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 100) / 100) : null);

function table(result, names) {
  const head = `| Row | ${names.map((n) => `${result.browsers[n].name} ${result.browsers[n].version}`).join(" | ")} |`;
  const lines = [head, `|---|${names.map(() => "---").join("|")}|`];
  for (const row of result.rows) {
    const cells = names.map((n) => {
      const b = row.browsers[n];
      if (b.median === null) return "–";
      return b.n > 1 ? `${b.median} ${row.unit} (${b.min}–${b.max}, n=${b.n})` : `${b.median} ${row.unit}`;
    });
    lines.push(`| ${row.label} | ${cells.join(" | ")} |`);
  }
  return lines.join("\n");
}

function breakdown(names) {
  const samples = readSamples().filter((s) => s.ok && s.kind === "session");
  const lines = [];
  for (const [label, get] of [
    ["memory at 20 tabs, MB", (s) => mapKinds(s.memory.tabs20.kinds, (v) => v)],
    ["memory at 1 tab, MB", (s) => mapKinds(s.memory.tabs1.kinds, (v) => v)],
    ["idle wakeups/s at 1 tab", (s) => mapKinds(s.idle.tabs1.kinds, (v) => v.wakeups)],
    ["idle wakeups/s at 20 tabs", (s) => mapKinds(s.idle.tabs20.kinds, (v) => v.wakeups)],
    ["idle CPU % at 20 tabs", (s) => mapKinds(s.idle.tabs20.kinds, (v) => v.cpu)],
  ]) {
    lines.push(`\n${label} (median per process kind)`);
    for (const n of names) {
      const per = samples.filter((s) => s.browser === n).map(get);
      const kinds = [...new Set(per.flatMap((p) => Object.keys(p)))].sort();
      lines.push(`  ${n}: ${kinds.map((k) => `${k} ${round(median(per.map((p) => p[k] ?? 0)))}`).join(", ")}`);
    }
  }
  return lines.join("\n");
}
const mapKinds = (kinds, f) => Object.fromEntries(Object.entries(kinds ?? {}).map(([k, v]) => [k, f(v)]));

async function signin(names) {
  for (const name of names) {
    const home = opt.base.find((b) => b.startsWith(`${name}=`))?.slice(name.length + 1);
    if (!home) throw new Error(`signin needs --base ${name}=<home>`);
    mkdirSync(home, { recursive: true });
    const app = new Instance(name, dirname(resolve(home)));
    app.home = resolve(home);
    await app.launch(null);
    log(`${name} is open (pid ${app.pid}) on ${app.home}: sign in, then quit it (⌘Q)`);
    const deadline = Date.now() + +opt.deadline * 60_000;
    while (app.alive() && Date.now() < deadline) await sleep(1000);
    await app.quit();
    log(`${name} quit; its HOME is ${app.home}`);
  }
}

function prepareBackgroundOnly(names) {
  for (const name of names) {
    if (spec(name).hidden || name !== baseOf(name)) throw new Error(`prepare-bg takes a competitor's own name, not ${name}`);
    const src = bundleOf(name);
    const dst = join(opt.apps, `${name}-bg`, basename(src));
    rmSync(dirname(dst), { recursive: true, force: true });
    mkdirSync(dirname(dst), { recursive: true });
    execFileSync("cp", ["-Rc", src, dst]);
    const plist = join(dst, "Contents/Info.plist");
    spawnSync("/usr/libexec/PlistBuddy", ["-c", "Delete :LSBackgroundOnly", plist]);
    execFileSync("/usr/libexec/PlistBuddy", ["-c", "Add :LSBackgroundOnly bool true", plist]);
    spawnSync("xattr", ["-rd", "com.apple.FinderInfo", dst]);
    const granted = execFileSync("codesign", ["-d", "--entitlements", "-", "--xml", src], { encoding: "utf8" });
    const restricted = /^(com\.apple\.application-identifier|com\.apple\.developer\..*|keychain-access-groups)$/;
    const kept = granted.replace(/<key>([^<]+)<\/key>\s*(<true\/>|<false\/>|<string>[^<]*<\/string>|<array>[\s\S]*?<\/array>|<array\/>)/g, (all, key) => (restricted.test(key) ? "" : all));
    const entitlements = join(dirname(dst), "entitlements.plist");
    writeFileSync(entitlements, kept);
    execFileSync("codesign", ["--force", "--sign", "-", "--entitlements", entitlements, "--preserve-metadata=identifier", dst], { stdio: "inherit" });
    const verify = spawnSync("codesign", ["--verify", "--strict", dst], { encoding: "utf8" });
    const flags = spawnSync("codesign", ["-dvv", dst], { encoding: "utf8" }).stderr.match(/flags=\S+/)?.[0];
    log(`${name}-bg: ${dst} (${verify.status === 0 ? "signature valid" : `signature: ${verify.stderr.trim()}`}, ${flags}, version ${info(dst).version})`);
  }
}

function clean(names) {
  const lsr = "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  for (const n of names) {
    let app;
    try {
      app = bundleOf(n);
    } catch {
      continue;
    }
    const exe = info(app).exe;
    const r = spawnSync("pgrep", ["-f", `^${exe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`], { encoding: "utf8" });
    for (const pid of r.stdout.trim().split("\n").filter(Boolean)) {
      log(`quitting a leftover ${n} (pid ${pid})`);
      try {
        process.kill(+pid, "SIGTERM");
      } catch {}
    }
    spawnSync(lsr, ["-u", app]);
  }
  rmSync(join(out, "runs"), { recursive: true, force: true });
  rmSync(join(out, "check"), { recursive: true, force: true });
  for (const n of names) {
    const guard = spec(n).guardPrefs && new PrefsGuard(info(bundleOf(n)).id);
    if (guard && existsSync(guard.file)) {
      log(`restoring ${guard.domain} from the snapshot a stopped run left`);
      guard.existed = true;
      guard.restore();
    }
  }
}

const names = opt.browsers.split(",").filter(Boolean);
for (const n of names) if (!spec(n)) throw new Error(`unknown browser ${n}`);
const command = positionals[0];
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const app of live) {
      for (const p of app.ownPids()) try {
        process.kill(p.pid, "SIGTERM");
      } catch {}
      if (app.prefs) spawnSync("sleep", ["3"]);
      try {
        app.prefs?.restore();
      } catch {}
    }
    gate.stop();
    if (lockHeld) releaseLock();
    process.exit(130);
  });
if (command === "report") {
  const result = report(names);
  const file = resolve(opt.json ?? join(out, "bench.json"));
  const md = `${table(result, names)}\n${breakdown(names)}\n`;
  const json = { ...result, rows: result.rows.filter((r) => !r.context) };
  const keyOf = (n) => (n !== baseOf(n) && names.filter((m) => baseOf(m) === baseOf(n)).length === 1 ? baseOf(n) : n);
  json.browsers = Object.fromEntries(Object.entries(json.browsers).map(([n, b]) => [keyOf(n), b]));
  for (const row of json.rows) {
    row.browsers = Object.fromEntries(Object.entries(row.browsers).map(([n, b]) => [keyOf(n), b]));
    row.best = row.best && keyOf(row.best);
  }
  writeFileSync(file, JSON.stringify(json, null, 2) + "\n");
  if (opt.md) writeFileSync(resolve(opt.md), md);
  else console.log(md);
  log(`wrote ${file}`);
} else if (command === "signin") {
  await startServer();
  try {
    await signin(names);
  } finally {
    server.close();
  }
} else if (command === "prepare-bg") {
  prepareBackgroundOnly(names);
} else if (command === "clean") {
  clean(names);
} else if (command === "run" || command === "check") {
  await startServer();
  try {
    if (command === "run") process.exitCode = (await run(names)) ? 75 : 0;
    else await check(names);
  } finally {
    server.close();
  }
} else {
  console.error(`unknown command ${command}`);
  process.exit(64);
}
