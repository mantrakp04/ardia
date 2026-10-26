#!/usr/bin/env node
// Real-world energy: Ardia against Helium and Dia on public, logged-out websites, in the window states a user's day
// has. Every browser gets the same tabs, window size, fresh copy of a template profile and phases, one instance at a
// time, browsers interleaved and rotated each round, holding the perflab lock for a round and giving it back after.
//
//   node apps/browser/scripts/perf/energy.mjs run    --out <dir> --browsers <a,b> [options]   measure (resumable)
//   node apps/browser/scripts/perf/energy.mjs report --out <dir> [--md <file>]                medians, ranges, kinds
//   node apps/browser/scripts/perf/energy.mjs clean  --out <dir> --browsers <a,b>             quit leftovers, delete runs
//
//     --browsers <a,b>     names: ardia[-tag], helium, dia (default ardia,helium,dia)
//     --app <name>=<path>  repeatable: the bundle of a browser (default <apps>/<base>/<Base>.app; Helium's -bg copy)
//     --apps <dir>         default /tmp/ac-xbench/apps
//     --base <name>=<home> repeatable: its template starts from a copy of this HOME (Dia: a throwaway signed-in home)
//     --env <name>=K=V     repeatable: extra environment for one browser
//     --args <name>=<sw>   repeatable: one extra switch for one browser
//     --video-only <name>  repeatable: that browser runs only the video phase (no hidden launch)
//     --setting <name>=K=V repeatable: an Ardia setting in each run's session.json (V is JSON: videoUpscaling=false)
//     --rounds <n>         default 3
//     --launches <a,b>     visible,hidden (default both). visible: idle in view, scroll, switch, video; hidden: minimized
//     --idle <secs>        each idle phase (default 180)
//     --active <secs>      the scroll and the switch phases (default 60)
//     --video <secs>       the video phase (default 60; 0 skips it)
//     --settle <secs>      after the tabs are opened (default 60)
//     --tabs <n>           how many of the site list to open (default all)
//     --port <n>           CDP port (default 9481); --page-port <n> (default 9491)
//     --deadline <mins>    stop starting items after this long (default 240)
//     --yield-to <pattern> repeatable: don't take the lab while a process whose command line matches it is alive
//     --max-load <n>       wait before an item while the 1-minute load average is over this (default 10)
//     --allow-focus        record a browser making itself the frontmost app instead of stopping (only when the owner
//                          agreed to it for this run)
//
// Window states: visible launches run every browser as if in view whatever covers it (Ardia's background mode with
// its forced visibility; Helium and Dia with --disable-backgrounding-occluded-windows), hidden launches let occlusion
// act (ARDIA_INSTANCE allowOcclusion; no switch) and minimize the window through CDP. All get --mute-audio.
// Metrics per process, summed per kind: CPU time, idle + interrupt wakeups, ri_energy_nj (macOS's per-process energy
// estimate), ri_billed_energy, and GPU time from the AGX user clients the process created.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { loadavg } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { appEnv, launchVariables, mergeLaunchEnv } from "../../../../scripts/lib/instance.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "/tmp/ac-energy/out" },
    browsers: { type: "string", default: "ardia,helium,dia" },
    apps: { type: "string", default: "/tmp/ac-xbench/apps" },
    app: { type: "string", multiple: true, default: [] },
    base: { type: "string", multiple: true, default: [] },
    env: { type: "string", multiple: true, default: [] },
    args: { type: "string", multiple: true, default: [] },
    setting: { type: "string", multiple: true, default: [] },
    "video-only": { type: "string", multiple: true, default: [] },
    rounds: { type: "string", default: "3" },
    launches: { type: "string", default: "visible,hidden" },
    idle: { type: "string", default: "180" },
    active: { type: "string", default: "60" },
    video: { type: "string", default: "60" },
    settle: { type: "string", default: "60" },
    tabs: { type: "string", default: "99" },
    port: { type: "string", default: "9481" },
    "page-port": { type: "string", default: "9491" },
    deadline: { type: "string", default: "240" },
    "allow-focus": { type: "boolean" },
    "max-load": { type: "string", default: "10" },
    "yield-to": { type: "string", multiple: true, default: [] },
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
const log = (...a) => console.error(`[energy ${new Date().toISOString().slice(11, 19)}]`, ...a);
const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const out = resolve(opt.out);
const port = +opt.port;
const WIN = { x: 40, y: 80, w: 1280, h: 800 };

const SITES = [
  { id: "canvas", url: "https://www.instructure.com/canvas" },
  { id: "wikipedia", url: "https://en.wikipedia.org/wiki/Lithium-ion_battery" },
  { id: "verge", url: "https://www.theverge.com/" },
  { id: "cnn", url: "https://edition.cnn.com/" },
  { id: "youtube", url: "https://www.youtube.com/" },
  { id: "github", url: "https://github.com/facebook/react" },
  { id: "reddit", url: "https://www.reddit.com/r/apple/" },
  { id: "x", url: "https://x.com/NASA" },
  { id: "docs", url: "https://docs.google.com/" },
  { id: "discord", url: "https://discord.com/" },
  { id: "animate", url: "https://animate.style/" },
];
const VIDEO_URL = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
const IDLE_TAB = "canvas";
const SCROLL_TAB = "verge";

const BROWSERS = {
  ardia: { name: "Ardia", bundle: "ardia/Ardia.app" },
  helium: { name: "Helium", bundle: "helium-bg/Helium.app" },
  dia: { name: "Dia", bundle: "dia/Dia.app", guardPrefs: true },
};
const baseOf = (name) => name.split("-")[0];
const spec = (name) => BROWSERS[baseOf(name)];
const isArdia = (name) => baseOf(name) === "ardia";
const perName = (list, name) => list.filter((e) => e.startsWith(`${name}=`)).map((e) => e.slice(name.length + 1));

const PROBE = `import AppKit
import ApplicationServices
import Darwin
import IOKit
var timebase = mach_timebase_info_data_t()
mach_timebase_info(&timebase)
func nanos(_ t: UInt64) -> UInt64 { t * UInt64(timebase.numer) / UInt64(timebase.denom) }
func gpuByPid() -> [Int32: UInt64] {
  var result: [Int32: UInt64] = [:]
  var accelerators: io_iterator_t = 0
  guard IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOAccelerator"), &accelerators) == KERN_SUCCESS else { return result }
  defer { IOObjectRelease(accelerators) }
  var clients: [io_registry_entry_t] = []
  while case let accelerator = IOIteratorNext(accelerators), accelerator != 0 {
    var children: io_iterator_t = 0
    if IORegistryEntryGetChildIterator(accelerator, kIOServicePlane, &children) == KERN_SUCCESS {
      while case let child = IOIteratorNext(children), child != 0 { clients.append(child) }
      IOObjectRelease(children)
    }
    IOObjectRelease(accelerator)
  }
  for entry in clients {
    defer { IOObjectRelease(entry) }
    guard let creator = IORegistryEntryCreateCFProperty(entry, "IOUserClientCreator" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? String,
          let pidText = creator.split(separator: ",").first?.split(separator: " ").last, let pid = Int32(pidText) else { continue }
    let usage = IORegistryEntryCreateCFProperty(entry, "AppUsage" as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue() as? [[String: Any]] ?? []
    for u in usage { result[pid, default: 0] += (u["accumulatedGPUTime"] as? NSNumber)?.uint64Value ?? 0 }
  }
  return result
}
func emit(_ v: Any) {
  print(String(data: try! JSONSerialization.data(withJSONObject: v, options: [.sortedKeys]), encoding: .utf8)!)
  fflush(stdout)
}
func sample(_ pids: [Int32]) {
  let gpu = gpuByPid()
  let at = Date().timeIntervalSince1970 * 1000
  for pid in pids {
    var info = rusage_info_v6()
    let rc = withUnsafeMutablePointer(to: &info) {
      $0.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(pid, RUSAGE_INFO_V6, $0) }
    }
    guard rc == 0 else { emit(["pid": pid, "gpuNs": gpu[pid] ?? 0, "at": at]); continue }
    emit(["pid": pid, "cpuNs": nanos(info.ri_user_time) + nanos(info.ri_system_time), "wakeups": info.ri_pkg_idle_wkups + info.ri_interrupt_wkups,
          "energyNj": info.ri_energy_nj, "billedNj": info.ri_billed_energy, "gpuNs": gpu[pid] ?? 0, "footprint": info.ri_phys_footprint, "at": at])
  }
}
func threads(_ pid: Int32) {
  var ids = [UInt64](repeating: 0, count: 4096)
  let n = proc_pidinfo(pid, PROC_PIDLISTTHREADS, 0, &ids, Int32(ids.count * 8)) / 8
  var rows: [[String: Any]] = []
  for i in 0..<Int(max(n, 0)) {
    var t = proc_threadinfo()
    guard proc_pidinfo(pid, PROC_PIDTHREADINFO, ids[i], &t, Int32(MemoryLayout<proc_threadinfo>.size)) > 0 else { continue }
    let name = withUnsafePointer(to: t.pth_name) { $0.withMemoryRebound(to: CChar.self, capacity: 64) { String(cString: $0) } }
    rows.append(["id": ids[i], "name": name, "cpuNs": t.pth_user_time + t.pth_system_time])
  }
  emit(rows)
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
      result.append(["w": r.width, "h": r.height, "covered": Double(covered) / Double(total)])
    }
    if alpha > 0 && owner != pid { above.append(r) }
  }
  return result
}
func state() -> [String: Any] {
  let session = CGSessionCopyCurrentDictionary() as? [String: Any]
  return ["locked": (session?["CGSSessionScreenIsLocked"] as? Bool) ?? false, "asleep": CGDisplayIsAsleep(CGMainDisplayID()) != 0,
          "front": NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0]
}
func minimize(_ pid: Int32) -> [String: Any] {
  let app = AXUIElementCreateApplication(pid)
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(app, kAXWindowsAttribute as CFString, &value) == .success, let windows = value as? [AXUIElement] else {
    return ["trusted": AXIsProcessTrusted(), "windows": 0]
  }
  var done = 0
  for w in windows {
    var size: CFTypeRef?
    AXUIElementCopyAttributeValue(w, kAXSizeAttribute as CFString, &size)
    var s = CGSize.zero
    if let size, CFGetTypeID(size) == AXValueGetTypeID() { AXValueGetValue(size as! AXValue, .cgSize, &s) }
    guard s.width >= 300 && s.height >= 200 else { continue }
    if AXUIElementSetAttributeValue(w, kAXMinimizedAttribute as CFString, kCFBooleanTrue) == .success { done += 1 }
  }
  return ["trusted": AXIsProcessTrusted(), "windows": windows.count, "minimized": done]
}
let args = CommandLine.arguments
switch args.count > 1 ? args[1] : "" {
case "sample": sample(args.dropFirst(2).compactMap { Int32($0) })
case "threads": threads(Int32(args[2]) ?? 0)
case "cover": emit(cover(Int32(args[2]) ?? 0))
case "state": emit(state())
case "minimize": emit(minimize(Int32(args[2]) ?? 0))
case "screen":
  let f = NSScreen.screens.first?.frame ?? .zero
  emit(["w": f.width, "h": f.height])
default: exit(64)
}
`;

const toolDir = join(out, ".tools");
function probeBin() {
  const bin = join(toolDir, "eprobe");
  if (!existsSync(bin) || !existsSync(bin + ".src") || readFileSync(bin + ".src", "utf8") !== PROBE) {
    mkdirSync(toolDir, { recursive: true });
    writeFileSync(join(toolDir, "eprobe.swift"), PROBE);
    execFileSync("swiftc", ["-O", join(toolDir, "eprobe.swift"), "-o", bin], { stdio: "inherit" });
    writeFileSync(bin + ".src", PROBE);
  }
  return bin;
}
const probeLines = (...a) => execFileSync(probeBin(), a, { encoding: "utf8", timeout: 20_000, maxBuffer: 16 << 20 }).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const probe = (...a) => probeLines(...a)[0] ?? null;

let server;
function startServer() {
  return new Promise((done) => {
    server = createServer((req, res) => {
      if (req.url.startsWith("/appcast.xml"))
        return res.writeHead(200, { "Content-Type": "application/xml" }).end('<?xml version="1.0"?><rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"><channel><title>none</title></channel></rss>');
      res.writeHead(404).end();
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
  socket(targetId) {
    let s = this.sockets.get(targetId);
    if (!s || s.ws.readyState > 1) this.sockets.set(targetId, (s = new Socket(`ws://127.0.0.1:${port}/devtools/page/${targetId}`)));
    return s;
  }
  async send(targetId, method, params, timeout = 4000) {
    try {
      return await this.socket(targetId).send(method, params, timeout);
    } catch (e) {
      this.sockets.delete(targetId);
      return { error: { message: e.message } };
    }
  }
  async evaluate(targetId, expression, timeout = 4000) {
    const r = await this.send(targetId, "Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeout);
    return r?.result?.result?.value;
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
function bundleInfo(app) {
  const plist = join(app, "Contents/Info.plist");
  const read = (key) => spawnSync("plutil", ["-extract", key, "raw", plist], { encoding: "utf8" }).stdout.trim();
  return { exe: join(realpathSync(app), "Contents/MacOS", read("CFBundleExecutable")), version: read("CFBundleShortVersionString"), id: read("CFBundleIdentifier") };
}
function bundleOf(name) {
  const given = perName(opt.app, name)[0];
  const app = resolve(given ?? join(opt.apps, spec(name).bundle));
  if (realpathSync(app).startsWith("/Applications/")) throw new Error(`${app} is in /Applications: run a copy`);
  if (!existsSync(app)) throw new Error(`no ${name} copy at ${app}`);
  return app;
}
const exeRe = (exe) => `^${exe.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`;

class PrefsGuard {
  constructor(domain) {
    this.domain = domain;
    this.file = join(out, "prefs-guard", `${domain}.plist`);
  }
  save() {
    mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
    this.existed = existsSync(join(process.env.HOME, "Library/Preferences", `${this.domain}.plist`));
    if (this.existed) {
      rmSync(this.file, { force: true });
      execFileSync("sh", ["-c", 'umask 077 && exec defaults export "$0" "$1"', this.domain, this.file]);
    }
    return this;
  }
  restore() {
    spawnSync("defaults", ["delete", this.domain], { stdio: "ignore" });
    if (this.existed) execFileSync("defaults", ["import", this.domain, this.file]);
    rmSync(this.file, { force: true });
  }
}

const live = new Set();
let lockHeld = false;

class Instance {
  constructor(name, dir, mode) {
    this.name = name;
    this.b = spec(name);
    this.app = bundleOf(name);
    this.info = bundleInfo(this.app);
    this.dir = dir;
    this.home = join(dir, "home");
    this.mode = mode;
    this.cdp = new Cdp();
  }
  alive() {
    try {
      process.kill(this.pid, 0);
      return true;
    } catch {
      return false;
    }
  }
  watched() {
    if (this.pid && !this.alive()) throw new Error(`${this.name} (pid ${this.pid}) died`);
    const front = probe("state").front;
    if (this.pid && front && this.ownPids().some((p) => p.pid === front)) {
      if (!opt["allow-focus"]) throw new Error(`${this.name} became the frontmost app: stopping`);
      this.tookFocus = true;
    }
  }
  env() {
    const env = { HOME: this.home, CFFIXED_USER_HOME: this.home };
    if (isArdia(this.name)) {
      const instance = { updateFeed: `http://127.0.0.1:${opt["page-port"]}/appcast.xml`, ...(this.mode === "hidden" ? { allowOcclusion: true } : {}) };
      Object.assign(env, { ARDIA_BACKGROUND: "1", ARDIA_DATA_DIR: join(this.home, "data"), ARDIA_REMOTE_DEBUGGING_PORT: String(port), ...launchVariables({ instance }) });
    }
    const extra = perName(opt.env, this.name).map((e) => ({ [e.slice(0, e.indexOf("="))]: e.slice(e.indexOf("=") + 1) }));
    const merged = mergeLaunchEnv(env, ...extra);
    return isArdia(this.name) ? appEnv(this.app, merged) : merged;
  }
  args() {
    const extra = perName(opt.args, this.name);
    if (isArdia(this.name)) return ["--no-first-run", "--no-default-browser-check", ...extra];
    return [`--user-data-dir=${join(this.home, "udd")}`, `--remote-debugging-port=${port}`, "--remote-allow-origins=*", "--no-first-run",
      "--no-default-browser-check", "--password-store=basic", "--use-mock-keychain", "--mute-audio", `--window-size=${WIN.w},${WIN.h}`,
      `--window-position=${WIN.x},${WIN.y}`, ...(this.mode === "visible" ? ["--disable-backgrounding-occluded-windows"] : []), ...extra];
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
    return rows.filter((r) => pids.has(r.pid)).map((r) => ({ pid: r.pid, kind: kindOf(r.command) }));
  }
  usage() {
    const procs = this.ownPids();
    const byPid = new Map(procs.map((p) => [p.pid, p]));
    return probeLines("sample", ...procs.map((p) => String(p.pid))).map((u) => ({ ...u, kind: byPid.get(u.pid)?.kind }));
  }
  async launch() {
    if (spawnSync("pgrep", ["-f", exeRe(this.info.exe)]).status === 0) throw new Error(`a ${this.name} instance is still running`);
    if (await this.cdp.get("/json/version")) throw new Error(`port ${port} is already taken`);
    if (this.b.guardPrefs) this.prefs = new PrefsGuard(this.info.id).save();
    const argv = ["-g", "-n", ...Object.entries(this.env()).flatMap(([k, v]) => ["--env", `${k}=${v}`]), "-a", this.app, "--args", ...this.args()];
    this.t0 = Date.now();
    execFileSync("open", argv);
    for (let i = 0; i < 400 && !this.pid; i++) {
      const r = spawnSync("pgrep", ["-f", exeRe(this.info.exe)], { encoding: "utf8" });
      if (r.status === 0) this.pid = +r.stdout.trim().split("\n")[0];
      else await sleep(25);
    }
    if (!this.pid) throw new Error(`${this.name} didn't start`);
    live.add(this);
    for (const end = Date.now() + 60_000; Date.now() < end; await sleep(100)) {
      if (!this.alive()) throw new Error(`${this.name} died at launch`);
      if (await this.cdp.browser().catch(() => null)) return this;
    }
    throw new Error(`${this.name}: no CDP endpoint on ${port}`);
  }
  async hold(ms) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(Math.min(2000, Math.max(0, end - Date.now())))) this.watched();
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
  }
}

function usageDelta(a, b, sitePids = new Map()) {
  const before = new Map(a.map((u) => [u.pid, u]));
  const kinds = {};
  const total = { cpu: 0, wakeups: 0, mw: 0, billedMw: 0, gpu: 0 };
  const sites = {};
  const procs = [];
  for (const u of b) {
    const p = before.get(u.pid);
    if (!p) continue;
    const secs = (u.at - p.at) / 1000;
    const d = {
      cpu: ((u.cpuNs - p.cpuNs) / 1e9 / secs) * 100,
      wakeups: (u.wakeups - p.wakeups) / secs,
      mw: (u.energyNj - p.energyNj) / 1e6 / secs,
      billedMw: (u.billedNj - p.billedNj) / 1e6 / secs,
      gpu: ((u.gpuNs - p.gpuNs) / 1e9 / secs) * 100,
    };
    const k = (kinds[u.kind] ??= { cpu: 0, wakeups: 0, mw: 0, billedMw: 0, gpu: 0, count: 0 });
    for (const f of Object.keys(total)) (k[f] += d[f]), (total[f] += d[f]);
    k.count++;
    const site = sitePids.get(u.pid);
    if (site) {
      const t = (sites[site] ??= { cpu: 0, mw: 0 });
      t.cpu += d.cpu;
      t.mw += d.mw;
    }
    procs.push({ pid: u.pid, kind: u.kind, ...Object.fromEntries(Object.entries(d).map(([f, v]) => [f, Math.round(v * 1000) / 1000])) });
  }
  procs.sort((x, y) => y.mw - x.mw);
  return { total, kinds, sites, procs: procs.slice(0, 8), processes: b.length };
}

async function measure(app, secs, work) {
  const loadBefore = loadavg()[0];
  const targetsBefore = await targetMetrics(app);
  const threadsBefore = probe("threads", String(app.pid));
  const a = app.usage();
  const cover = probe("cover", String(app.pid));
  const ws = probeLines("sample", String(windowServerPid()))[0];
  const extra = work ? await work(Date.now() + secs * 1000) : (await app.hold(secs * 1000), null);
  const b = app.usage();
  const ws2 = probeLines("sample", String(windowServerPid()))[0];
  const threadsAfter = probe("threads", String(app.pid));
  const targetsAfter = await targetMetrics(app);
  const secsReal = (b[0]?.at - a[0]?.at) / 1000;
  const before = new Map((threadsBefore ?? []).map((t) => [t.id, t]));
  const threads = (threadsAfter ?? []).map((t) => ({ name: t.name || `#${t.id}`, cpu: before.has(t.id) ? ((t.cpuNs - before.get(t.id).cpuNs) / 1e9 / secsReal) * 100 : NaN }))
    .filter((t) => t.cpu > 0.05).sort((x, y) => y.cpu - x.cpu).slice(0, 8).map((t) => ({ ...t, cpu: Math.round(t.cpu * 100) / 100 }));
  const windowServer = ws && ws2 ? { gpu: ((ws2.gpuNs - ws.gpuNs) / 1e9 / secsReal) * 100 } : null;
  const targets = targetsAfter.map((t) => {
    const p = targetsBefore.find((x) => x.id === t.id);
    return p && { url: t.url, type: t.type, busy: Math.round(((t.task - p.task) / secsReal) * 1000) / 10, script: Math.round(((t.script - p.script) / secsReal) * 1000) / 10 };
  }).filter((t) => t && t.busy > 0.05).sort((x, y) => y.busy - x.busy).slice(0, 8);
  return { ...usageDelta(a, b, app.sitePids ?? new Map()), secs: secsReal, cover, browserThreads: threads, targets, windowServer, cond: { ...probe("state"), load: Math.max(loadBefore, loadavg()[0]) }, ...(extra ? { extra } : {}) };
}

async function targetMetrics(app) {
  const list = ((await app.cdp.get("/json/list")) ?? []).filter((t) => t.webSocketDebuggerUrl && /^(page|other|background_page|webview)$/.test(t.type));
  return (await Promise.all(list.map(async (t) => {
    await app.cdp.send(t.id, "Performance.enable", {}, 2500);
    const r = await app.cdp.send(t.id, "Performance.getMetrics", {}, 2500);
    const m = Object.fromEntries((r?.result?.metrics ?? []).map((x) => [x.name, x.value]));
    return m.TaskDuration === undefined ? null : { id: t.id, url: t.url.slice(0, 70), type: t.type, task: m.TaskDuration, script: m.ScriptDuration ?? 0 };
  }))).filter(Boolean);
}
let wsPid;
function windowServerPid() {
  if (!wsPid) wsPid = +spawnSync("pgrep", ["-x", "WindowServer"], { encoding: "utf8" }).stdout.trim().split("\n")[0];
  return wsPid;
}

const templateDir = (name) => join(out, "templates", name);

async function makeTemplate(name) {
  const dir = templateDir(name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const baseHome = perName(opt.base, name)[0];
  if (baseHome) execFileSync("cp", ["-Rc", resolve(baseHome), join(dir, "home")]);
  else mkdirSync(join(dir, "home"), { recursive: true });
  if (isArdia(name)) {
    mkdirSync(join(dir, "home/data"), { recursive: true });
    writeFileSync(join(dir, "home/data/onboarding.json"), JSON.stringify({ version: 1, completedAt: 1 }));
  }
  log(`making ${name}'s template profile`);
  const app = await new Instance(name, dir, "visible").launch();
  try {
    await app.hold(3000);
    await app.cdp.call("Target.createTarget", { url: "https://en.wikipedia.org/wiki/Main_Page" });
    await app.hold(90_000);
    for (const t of await app.cdp.pages()) if (!t.url.includes("wikipedia")) await app.cdp.call("Target.closeTarget", { targetId: t.id }).catch(() => null);
    await app.hold(5000);
    writeFileSync(join(dir, "template.json"), JSON.stringify({ made: new Date().toISOString(), browser: app.cdp.version?.Browser, info: app.info }, null, 2));
  } finally {
    await app.quit();
  }
  if (isArdia(name)) fixArdiaSession(join(dir, "home/data/session.json"));
  for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) rmSync(join(dir, "home/udd", f), { force: true });
}

function fixArdiaSession(file) {
  if (!existsSync(file)) return;
  const session = JSON.parse(readFileSync(file, "utf8"));
  const { h } = probe("screen");
  for (const w of session.windows ?? []) if (!w.kind) w.frame = [WIN.x, h - WIN.y - WIN.h, WIN.w, WIN.h];
  writeFileSync(file, JSON.stringify(session));
}

function runDir(key, name) {
  const dir = join(out, "runs", key.replaceAll("/", "-"));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dirname(dir), { recursive: true });
  execFileSync("cp", ["-Rc", templateDir(name), dir]);
  const settings = perName(opt.setting, name);
  const file = join(dir, "home/data/session.json");
  if (settings.length && existsSync(file)) {
    const session = JSON.parse(readFileSync(file, "utf8"));
    for (const e of settings) (session.settings ??= {})[e.slice(0, e.indexOf("="))] = JSON.parse(e.slice(e.indexOf("=") + 1));
    writeFileSync(file, JSON.stringify(session));
  }
  return dir;
}

async function openSites(app) {
  const sites = SITES.slice(0, +opt.tabs);
  const before = new Set((await app.cdp.pages()).map((t) => t.id));
  const ids = {};
  for (const s of sites) {
    const { targetId } = await app.cdp.call("Target.createTarget", { url: s.url });
    ids[s.id] = targetId;
    await app.hold(1500);
  }
  for (const t of await app.cdp.pages()) if (before.has(t.id)) await app.cdp.call("Target.closeTarget", { targetId: t.id }).catch(() => null);
  return ids;
}

async function mapRenderers(app, ids) {
  app.sitePids = new Map();
  const cpu = () => new Map(app.usage().filter((u) => u.kind === "renderer").map((u) => [u.pid, u.cpuNs]));
  for (const [site, targetId] of Object.entries(ids)) {
    const a = cpu();
    await app.cdp.evaluate(targetId, "(() => { const end = performance.now() + 300; while (performance.now() < end) {} })()", 3000);
    const b = cpu();
    let best = null;
    for (const [pid, ns] of b) if (a.has(pid) && ns - a.get(pid) > 200e6 && (!best || ns - a.get(pid) > best[1])) best = [pid, ns - a.get(pid)];
    if (best && !app.sitePids.has(best[0])) app.sitePids.set(best[0], site);
  }
  return Object.fromEntries([...app.sitePids].map(([pid, site]) => [site, pid]));
}

async function placeWindow(app, targetId) {
  if (isArdia(app.name)) return null;
  const w = await app.cdp.call("Browser.getWindowForTarget", { targetId }).catch(() => null);
  if (!w) return null;
  await app.cdp.call("Browser.setWindowBounds", { windowId: w.windowId, bounds: { windowState: "normal" } }).catch(() => null);
  await app.cdp.call("Browser.setWindowBounds", { windowId: w.windowId, bounds: { left: WIN.x, top: WIN.y, width: WIN.w, height: WIN.h } }).catch(() => null);
  return w.windowId;
}

async function activate(app, targetId) {
  await app.cdp.call("Target.activateTarget", { targetId }).catch(() => null);
}

async function tabStates(app, ids) {
  const states = {};
  for (const [id, targetId] of Object.entries(ids))
    states[id] = await app.cdp.evaluate(targetId, `JSON.stringify({ v: document.visibilityState, u: location.host + location.pathname.slice(0, 30), w: innerWidth, h: innerHeight })`, 2500).then((s) => (s ? JSON.parse(s) : null)).catch(() => null);
  return states;
}

async function scrollFor(app, targetId, end) {
  let n = 0;
  let dir = 1;
  const flip = setInterval(() => (dir = -dir), 15_000);
  try {
    while (Date.now() < end) {
      await app.cdp.send(targetId, "Input.dispatchMouseEvent", { type: "mouseWheel", x: 600, y: 400, deltaX: 0, deltaY: 100 * dir }, 2000);
      n++;
      await sleep(100);
    }
  } finally {
    clearInterval(flip);
  }
  const y = await app.cdp.evaluate(targetId, "scrollY");
  return { wheels: n, scrollY: y };
}

async function switchFor(app, ids, end) {
  const order = Object.values(ids);
  let k = 0;
  while (Date.now() < end) {
    await activate(app, order[k++ % order.length]);
    await sleep(Math.min(5000, Math.max(0, end - Date.now())));
    app.watched();
  }
  return { switches: k };
}

const VIDEO_STATE = `(() => { const v = document.querySelector("video"); if (!v) return null; const q = v.getVideoPlaybackQuality?.();
  return { t: v.currentTime, paused: v.paused, muted: v.muted, w: v.videoWidth, h: v.videoHeight, dropped: q?.droppedVideoFrames ?? null, frames: q?.totalVideoFrames ?? null,
    ad: !!document.querySelector(".ad-showing") }; })()`;

async function startVideo(app) {
  const { targetId } = await app.cdp.call("Target.createTarget", { url: VIDEO_URL });
  await activate(app, targetId);
  let st = null;
  for (const end = Date.now() + 45_000; Date.now() < end; await sleep(1000)) {
    await app.cdp.evaluate(targetId, `(() => { const v = document.querySelector("video"); if (v) { v.muted = true; if (v.paused) v.play().catch(() => {}); } })()`);
    const a = await app.cdp.evaluate(targetId, VIDEO_STATE);
    await sleep(1000);
    st = await app.cdp.evaluate(targetId, VIDEO_STATE);
    if (a && st && !st.paused && st.t > a.t && !st.ad) break;
  }
  return { targetId, start: st };
}

async function visibleItem(name, key) {
  const dir = runDir(key, name);
  const app = new Instance(name, dir, "visible");
  const r = { phases: {} };
  try {
    await app.launch();
    await app.hold(3000);
    const ids = await openSites(app);
    await placeWindow(app, ids[IDLE_TAB]);
    await activate(app, ids[IDLE_TAB]);
    await app.hold(+opt.settle * 1000);
    await activate(app, ids[IDLE_TAB]);
    r.renderers = await mapRenderers(app, ids);
    await app.hold(10_000);
    r.tabs = await tabStates(app, ids);
    if (!opt["video-only"].includes(name)) {
      r.phases.idleVisible = await measure(app, +opt.idle);
      await activate(app, ids[SCROLL_TAB]);
      await app.hold(5000);
      r.phases.scroll = await measure(app, +opt.active, (end) => scrollFor(app, ids[SCROLL_TAB], end));
      r.phases.switch = await measure(app, +opt.active, (end) => switchFor(app, ids, end));
    }
    if (+opt.video > 0) {
      const v = await startVideo(app);
      await app.hold(3000);
      r.phases.video = await measure(app, +opt.video, async (end) => {
        const a = await app.cdp.evaluate(v.targetId, VIDEO_STATE);
        await app.hold(Math.max(0, end - Date.now()));
        return { before: a, after: await app.cdp.evaluate(v.targetId, VIDEO_STATE) };
      });
    }
    r.pages = (await app.cdp.pages()).length;
  } finally {
    await app.quit();
    rmSync(dir, { recursive: true, force: true });
  }
  r.tookFocus = !!app.tookFocus;
  return r;
}

async function minimize(app, targetId) {
  const r = probe("minimize", String(app.pid));
  await sleep(2000);
  const visibility = await app.cdp.evaluate(targetId, "document.visibilityState");
  return { ...r, visibility, cover: probe("cover", String(app.pid)) };
}

async function hiddenItem(name, key) {
  const dir = runDir(key, name);
  const app = new Instance(name, dir, "hidden");
  const r = { phases: {} };
  try {
    await app.launch();
    await app.hold(3000);
    const ids = await openSites(app);
    await placeWindow(app, ids[IDLE_TAB]);
    await activate(app, ids[IDLE_TAB]);
    await app.hold(+opt.settle * 1000);
    await activate(app, ids[IDLE_TAB]);
    r.renderers = await mapRenderers(app, ids);
    await app.hold(5000);
    r.minimize = await minimize(app, ids[IDLE_TAB]);
    await app.hold(30_000);
    r.tabs = await tabStates(app, ids);
    r.phases.idleHidden = await measure(app, +opt.idle);
    r.tabsAfter = await tabStates(app, ids);
  } finally {
    await app.quit();
    rmSync(dir, { recursive: true, force: true });
  }
  r.tookFocus = !!app.tookFocus;
  return r;
}

function readSamples() {
  const file = join(out, "samples.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const record = (s) => appendFileSync(join(out, "samples.jsonl"), JSON.stringify(s) + "\n");

function plan(names) {
  const items = [];
  for (let r = 0; r < +opt.rounds; r++) {
    const order = names.map((_, i) => names[(i + r) % names.length]);
    for (const launch of opt.launches.split(","))
      for (const n of order) if (launch === "visible" || !opt["video-only"].includes(n)) items.push({ key: `r${r}/${launch}/${n}`, round: r, launch, browser: n });
  }
  return items;
}

function takeLock() {
  const r = spawnSync(join(repoRoot, "scripts/agent/locked"), ["perflab", "--take", "energy", "--ttl", "30", "--wait", "590"], { encoding: "utf8" });
  lockHeld = r.status === 0;
  return lockHeld;
}
function releaseLock() {
  lockHeld = false;
  spawnSync(join(repoRoot, "scripts/agent/locked"), ["perflab", "--release", "energy"], { encoding: "utf8" });
}

async function run(names) {
  const deadline = Date.now() + +opt.deadline * 60_000;
  mkdirSync(out, { recursive: true });
  const done = new Set(readSamples().filter((s) => s.ok).map((s) => s.key));
  const items = plan(names).filter((i) => !done.has(i.key));
  log(`${items.length} items to run (${done.size} done)`);
  const estimate = { visible: (+opt.settle + +opt.idle + 2 * +opt.active + +opt.video + 90) * 1000, hidden: (+opt.settle + +opt.idle + 90) * 1000 };
  let round = items[0]?.round;
  for (const item of items) {
    if (item.round !== round && lockHeld) {
      log(`round ${round} done: the lab is free for a while`);
      releaseLock();
      await sleep(20_000);
    }
    round = item.round;
    if (Date.now() + estimate[item.launch] > deadline) {
      log("deadline: stopping; run again to resume");
      break;
    }
    const yielding = () => opt["yield-to"].some((p) => spawnSync("pgrep", ["-f", p]).status === 0);
    for (let said = 0, clearSince = yielding() ? 0 : Date.now(); (!clearSince || Date.now() - clearSince < 180_000) && opt["yield-to"].length && Date.now() + estimate[item.launch] < deadline; await sleep(15_000), clearSince = yielding() ? 0 : clearSince || Date.now())
      if (Date.now() - said > 600_000) {
        said = Date.now();
        if (lockHeld) releaseLock();
        log(`yielding the lab to ${opt["yield-to"].join(", ")}`);
      }
    while (!takeLock()) {
      if (Date.now() + estimate[item.launch] > deadline) return 75;
      log("perflab is busy; waiting");
    }
    for (let said = 0; loadavg()[0] > +opt["max-load"] && Date.now() + estimate[item.launch] < deadline; await sleep(15_000))
      if (Date.now() - said > 300_000) said = Date.now(), log(`load ${loadavg()[0].toFixed(1)} is over ${opt["max-load"]}: waiting`);
    try {
      if (!existsSync(join(templateDir(item.browser), "template.json"))) await makeTemplate(item.browser);
      const started = Date.now();
      const data = item.launch === "visible" ? await visibleItem(item.browser, item.key) : await hiddenItem(item.browser, item.key);
      const s = { ...item, ok: true, at: new Date(started).toISOString(), version: bundleInfo(bundleOf(item.browser)).version, ...data };
      if (data.tookFocus) log(`${item.key}: the browser became the frontmost app during the run`);
      record(s);
      log(`${item.key}:`, Object.entries(s.phases).map(([p, v]) => `${p} ${v.total.mw.toFixed(0)} mW cpu ${v.total.cpu.toFixed(1)}% gpu ${v.total.gpu.toFixed(1)}% wk ${v.total.wakeups.toFixed(0)}/s`).join(" | "));
    } catch (e) {
      record({ ...item, ok: false, at: new Date().toISOString(), failed: e.message });
      log(`${item.key} failed: ${e.message}`);
      if (/frontmost/.test(e.message)) throw e;
    }
    await sleep(5000);
  }
  if (lockHeld) releaseLock();
  return plan(names).filter((i) => !new Set(readSamples().filter((s) => s.ok).map((s) => s.key)).has(i.key)).length ? 75 : 0;
}

const fmt = (x) => (Number.isFinite(x) ? (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10) : "–");
function report(names) {
  const samples = readSamples().filter((s) => s.ok);
  const phases = ["idleVisible", "idleHidden", "scroll", "switch", "video"];
  const metrics = [["mw", "energy mW"], ["cpu", "CPU %"], ["gpu", "GPU %"], ["wakeups", "wakeups/s"]];
  const lines = [];
  const versions = Object.fromEntries(names.map((n) => [n, samples.find((s) => s.browser === n)?.version ?? "?"]));
  const without = (ph, m) => ph.total[m] - (m === "mw" || m === "cpu" ? ph.sites?.discord?.[m] ?? 0 : 0);
  for (const [m, label] of metrics) {
    lines.push(`\n${label} (median, min–max, n)\n`, `| Phase | ${names.map((n) => `${n} ${versions[n]}`).join(" | ")} |`, `|---|${names.map(() => "---").join("|")}|`);
    for (const p of [...phases, ...(m === "mw" || m === "cpu" ? phases.map((x) => `${x} without discord.com`) : [])]) {
      const [phase, minus] = p.endsWith(" without discord.com") ? [p.split(" ")[0], true] : [p, false];
      const cells = names.map((n) => {
        const xs = samples.filter((s) => s.browser === n && s.phases[phase] && (!minus || s.phases[phase].sites)).map((s) => (minus ? without(s.phases[phase], m) : s.phases[phase].total[m]));
        return xs.length ? `${fmt(median(xs))} (${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))}, n=${xs.length})` : "–";
      });
      if (cells.some((c) => c !== "–")) lines.push(`| ${p} | ${cells.join(" | ")} |`);
    }
  }
  for (const p of phases) {
    lines.push(`\n${p}: energy mW / CPU % / GPU % per process kind (median)`);
    for (const n of names) {
      const per = samples.filter((s) => s.browser === n && s.phases[p]).map((s) => s.phases[p].kinds);
      if (!per.length) continue;
      const kinds = [...new Set(per.flatMap((k) => Object.keys(k)))].sort();
      lines.push(`  ${n}: ${kinds.map((k) => `${k} ${fmt(median(per.map((x) => x[k]?.mw ?? 0)))}/${fmt(median(per.map((x) => x[k]?.cpu ?? 0)))}/${fmt(median(per.map((x) => x[k]?.gpu ?? 0)))}`).join(", ")}`);
      const ws = samples.filter((s) => s.browser === n && s.phases[p]?.windowServer).map((s) => s.phases[p].windowServer);
      if (ws.length) lines.push(`    WindowServer GPU during it: ${fmt(median(ws.map((w) => w.gpu)))}%`);
    }
  }
  return lines.join("\n");
}

function clean(names) {
  for (const n of names) {
    let exe;
    try {
      exe = bundleInfo(bundleOf(n)).exe;
    } catch {
      continue;
    }
    for (const pid of spawnSync("pgrep", ["-f", exeRe(exe)], { encoding: "utf8" }).stdout.trim().split("\n").filter(Boolean)) {
      log(`quitting a leftover ${n} (pid ${pid})`);
      try {
        process.kill(+pid, "SIGTERM");
      } catch {}
    }
  }
  rmSync(join(out, "runs"), { recursive: true, force: true });
}

const names = opt.browsers.split(",").filter(Boolean);
for (const n of names) if (!spec(n)) throw new Error(`unknown browser ${n}`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    for (const app of live) {
      for (const p of app.ownPids()) try {
        process.kill(p.pid, "SIGTERM");
      } catch {}
      try {
        if (app.prefs) spawnSync("sleep", ["3"]), app.prefs.restore();
      } catch {}
    }
    if (lockHeld) releaseLock();
    process.exit(130);
  });
const command = positionals[0];
if (command === "report") {
  const md = report(names);
  if (opt.md) writeFileSync(resolve(opt.md), md + "\n");
  console.log(md);
} else if (command === "clean") {
  clean(names);
} else if (command === "run") {
  await startServer();
  try {
    process.exitCode = await run(names);
  } finally {
    server.close();
    if (lockHeld) releaseLock();
  }
} else {
  console.error(`unknown command ${command}`);
  process.exit(64);
}
