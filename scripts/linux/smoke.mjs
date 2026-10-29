#!/usr/bin/env node
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { copyFile, mkdir, mkdtemp, readdir, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { closeAllApps, killAllAppsNow, launchArdia, launchArguments, launchEnvironment } from "../../apps/linux/scripts/acceptance/lib/ardia.mjs";
import { connectCdp, evaluate } from "../../apps/linux/scripts/acceptance/lib/cdp.mjs";
import { errorText, js, nonce, until, withDeadline } from "../../apps/linux/scripts/acceptance/lib/util.mjs";

export const USAGE = `Usage: node scripts/linux/smoke.mjs --package <Ardia-linux-x64-*.tar.xz> --results <dir> [--timeout-ms N] [--keep]

Strict smoke gate for a packaged Ardia Linux build. It extracts the tarball into
a temporary folder, launches ardia/bin/ardia headless (ozone headless, SwiftShader,
ARDIA_BACKGROUND=1, a throwaway profile and HOME, the sandbox on) without
--ardia-ui-dir, and checks:

  ldd               lib/ardia/chrome has no unresolved libraries
  shell-ui          chrome://ardia/ renders the bundled production UI from lib/ardia/ardia-ui
  bootstrap         the native bootstrap reports appBuild "linux-host"
  native-tab        a native tab loads a local HTTP fixture, visibly, without window.__ardiaHost
  sandbox           every renderer runs under seccomp-bpf in its own namespaces, no --no-sandbox
  content-blocker   the packaged uBlock Origin and its Linux bridge are present and load
  restart-restore   after a clean quit and relaunch on the same profile the fixture tab is restored
  staged-install    install.sh --destdir stages the launcher, desktop entry, runtime and polkit policy

It writes <results>/results.json ({ok, package, started, assertions[]}) and the
launch logs to <results>, prints a table, and exits 0 only when every check ran
and passed.

  --package FILE    the package tarball (required)
  --results DIR     where results.json and logs go (required)
  --timeout-ms N    hard deadline for the whole run (default 300000)
  --keep            keep the extracted package, profile and staged install
  -h, --help        show this help
`;

export const ASSERTIONS = ["ldd", "shell-ui", "bootstrap", "native-tab", "sandbox", "content-blocker", "restart-restore", "staged-install"];
export const FORBIDDEN_SWITCHES = ["--no-sandbox", "--disable-seccomp-filter-sandbox", "--disable-namespace-sandbox", "--disable-setuid-sandbox", "--disable-gpu-sandbox", "--no-zygote-sandbox", "--single-process", "--in-process-gpu"];
export const TREE_FORBIDDEN_SWITCHES = ["--no-sandbox", "--disable-seccomp-filter-sandbox", "--disable-namespace-sandbox", "--disable-setuid-sandbox"];
export const STAGED_FILES = [
  { path: "usr/bin/ardia", mode: 0o755 },
  { path: "usr/share/applications/ardia.desktop", mode: 0o644 },
  { path: "usr/lib/ardia/chrome", mode: 0o755 },
  { path: "usr/lib/ardia/ardia-ui/index.html", mode: 0o644 },
  { path: "usr/share/polkit-1/actions/dev.ardia.linux.policy", mode: 0o644 },
];
export const BLOCKER_FILES = ["manifest.json", "js/vapi.js", "js/vapi-common.js", "js/vapi-client.js"];
const BRIDGE_DIR = new URL("../../engine/ardiacore-linux/content-blocker/", import.meta.url);
const DEFAULT_TIMEOUT_MS = 300000;

export function parseArgs(argv) {
  const options = { package: null, results: null, timeoutMs: DEFAULT_TIMEOUT_MS, keep: false, help: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = () => {
      const next = argv[++index];
      if (next === undefined || next.startsWith("--")) throw new Error(`${arg} needs a value`);
      return next;
    };
    if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--package") options.package = value();
    else if (arg === "--results") options.results = value();
    else if (arg === "--timeout-ms") {
      const raw = value();
      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--timeout-ms must be a positive integer, not ${raw}`);
      options.timeoutMs = parsed;
    } else if (arg === "--keep") options.keep = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.help && (!options.package || !options.results)) throw new Error("--package and --results are required");
  return options;
}

export function forbiddenSwitches(args, names = FORBIDDEN_SWITCHES) {
  return args.filter((arg) => names.some((name) => arg === name || arg.startsWith(`${name}=`)));
}

export function launchRefusal(args, env) {
  const refused = forbiddenSwitches(args);
  if (refused.length) return `refusing to launch with ${refused.join(" ")}`;
  if (args.some((arg) => arg.startsWith("--ardia-ui-dir"))) return "refusing to launch with --ardia-ui-dir";
  if (!args.includes("--ozone-platform=headless") || args.some((arg) => arg.startsWith("--ozone-platform=") && arg !== "--ozone-platform=headless")) return "refusing to launch without --ozone-platform=headless";
  if (env.ARDIA_BACKGROUND !== "1") return "refusing to launch without ARDIA_BACKGROUND=1";
  if (env.DISPLAY || env.WAYLAND_DISPLAY) return "refusing to launch with a DISPLAY or WAYLAND_DISPLAY";
  if (env.ARDIA_SWITCHES) return "refusing to launch with ARDIA_SWITCHES";
  return null;
}

export function lddMissing(output) {
  return output.split("\n").map((line) => line.trim()).filter((line) => /\bnot found\b/.test(line));
}

export function parseStat(text) {
  const close = text.lastIndexOf(")");
  if (close < 0) return null;
  const fields = text.slice(close + 2).trim().split(/\s+/);
  return { state: fields[0], ppid: Number(fields[1]), pgrp: Number(fields[2]) };
}

export function parseStatus(text) {
  const field = (name) => text.match(new RegExp(`^${name}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? null;
  const numbers = (value) => (value ? value.split(/\s+/).map(Number) : []);
  const seccomp = field("Seccomp");
  return { seccomp: seccomp === null ? null : Number(seccomp), seccompFilters: field("Seccomp_filters") === null ? null : Number(field("Seccomp_filters")), nspid: numbers(field("NSpid")), uid: numbers(field("Uid")), noNewPrivs: field("NoNewPrivs") === null ? null : Number(field("NoNewPrivs")) };
}

export function commandLine(text) {
  return text.split(/[\0 ]+/).filter(Boolean);
}

export function processType(argv) {
  return argv.find((arg) => arg.startsWith("--type="))?.slice("--type=".length) ?? "browser";
}

export function processTree(processes, rootPid) {
  const children = new Map();
  for (const proc of processes) {
    if (!children.has(proc.ppid)) children.set(proc.ppid, []);
    children.get(proc.ppid).push(proc);
  }
  const seen = new Set();
  const tree = [];
  const queue = processes.filter((proc) => proc.pid === rootPid);
  while (queue.length) {
    const proc = queue.shift();
    if (seen.has(proc.pid)) continue;
    seen.add(proc.pid);
    tree.push(proc);
    queue.push(...(children.get(proc.pid) ?? []));
  }
  for (const proc of processes) if (!seen.has(proc.pid) && proc.pgrp === rootPid) { seen.add(proc.pid); tree.push(proc); }
  return tree;
}

export function sandboxVerdict(tree, rootPid) {
  const problems = [];
  const browser = tree.find((proc) => proc.pid === rootPid);
  if (!browser) problems.push(`the browser process ${rootPid} is not in the tree`);
  const renderers = tree.filter((proc) => processType(proc.argv) === "renderer");
  if (!renderers.length) problems.push("no renderer process was found under the browser");
  for (const proc of tree) {
    const bad = forbiddenSwitches(proc.argv, TREE_FORBIDDEN_SWITCHES);
    if (bad.length) problems.push(`pid ${proc.pid} (${processType(proc.argv)}) runs with ${bad.join(" ")}`);
  }
  const rendererDetails = renderers.map((proc) => {
    const nestedPid = browser ? proc.status.nspid.length > browser.status.nspid.length : false;
    const otherUserNs = Boolean(browser?.ns.user && proc.ns.user && proc.ns.user !== browser.ns.user);
    const otherPidNs = Boolean(browser?.ns.pid && proc.ns.pid && proc.ns.pid !== browser.ns.pid);
    const isolated = nestedPid || otherUserNs || otherPidNs;
    if (proc.status.seccomp !== 2) problems.push(`renderer ${proc.pid} has Seccomp ${proc.status.seccomp}, not 2 (filter)`);
    if (!isolated) problems.push(`renderer ${proc.pid} shares the browser's user and pid namespaces (NSpid ${proc.status.nspid.join(" ")}, user ${proc.ns.user ?? "unreadable"}, pid ${proc.ns.pid ?? "unreadable"})`);
    return { pid: proc.pid, seccomp: proc.status.seccomp, seccompFilters: proc.status.seccompFilters, noNewPrivs: proc.status.noNewPrivs, nspid: proc.status.nspid, userNs: proc.ns.user, pidNs: proc.ns.pid, nestedPid, otherUserNs, otherPidNs };
  });
  return {
    ok: problems.length === 0,
    problems,
    browser: browser ? { pid: browser.pid, nspid: browser.status.nspid, userNs: browser.ns.user, pidNs: browser.ns.pid, seccomp: browser.status.seccomp } : null,
    renderers: rendererDetails,
    processes: tree.map((proc) => ({ pid: proc.pid, ppid: proc.ppid, type: processType(proc.argv), seccomp: proc.status.seccomp, nspid: proc.status.nspid })),
  };
}

export function modeProblems(entries) {
  const problems = [];
  for (const { path, expected, actual } of entries) {
    if (actual === null) problems.push(`${path} is missing`);
    else if (!actual.isFile) problems.push(`${path} is not a regular file`);
    else if ((actual.mode & 0o7777) !== expected) problems.push(`${path} has mode ${(actual.mode & 0o7777).toString(8)}, expected ${expected.toString(8)}`);
  }
  return problems;
}

export function summarize(assertions) {
  const names = assertions.map((a) => a.name);
  const missing = ASSERTIONS.filter((name) => !names.includes(name));
  return { ok: missing.length === 0 && assertions.length > 0 && assertions.every((a) => a.ok === true), missing };
}

export function formatTable(assertions) {
  const rows = assertions.map((a) => [a.ok ? "pass" : "FAIL", a.name, `${(a.ms / 1000).toFixed(1)} s`, a.ok ? "" : String(a.detail?.error ?? a.detail ?? "").replace(/\s+/g, " ").slice(0, 160)]);
  const widths = [4, Math.max(...ASSERTIONS.map((n) => n.length), ...rows.map((r) => r[1].length)), Math.max(6, ...rows.map((r) => r[2].length))];
  return rows.map((r) => `${r[0].padEnd(widths[0])}  ${r[1].padEnd(widths[1])}  ${r[2].padStart(widths[2])}  ${r[3]}`.trimEnd()).join("\n");
}

const sha256 = (buffer) => createHash("sha256").update(buffer).digest("hex");

export function pngInk(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33 || buffer.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let offset = 8;
  let header = null;
  const data = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const body = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    else if (type === "IDAT") data.push(body);
    else if (type === "IEND") break;
    offset += 12 + length;
  }
  if (!header) throw new Error("the PNG has no IHDR");
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[header.color];
  if (header.depth !== 8 || !channels || header.interlace !== 0) throw new Error(`unsupported PNG: depth ${header.depth}, color ${header.color}, interlace ${header.interlace}`);
  const raw = inflateSync(Buffer.concat(data));
  const stride = header.width * channels;
  const colorChannels = channels >= 3 ? 3 : 1;
  let previous = Buffer.alloc(stride);
  let ink = 0;
  for (let row = 0; row < header.height; row++) {
    const start = row * (stride + 1);
    const filter = raw[start];
    const line = Buffer.from(raw.subarray(start + 1, start + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const left = i >= channels ? line[i - channels] : 0;
      const up = previous[i];
      const corner = i >= channels ? previous[i - channels] : 0;
      let add = 0;
      if (filter === 1) add = left;
      else if (filter === 2) add = up;
      else if (filter === 3) add = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - corner;
        const [a, b, c] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - corner)];
        add = a <= b && a <= c ? left : b <= c ? up : corner;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      line[i] = (line[i] + add) & 0xff;
    }
    for (let x = 0; x < header.width; x++) {
      let dark = false;
      for (let c = 0; c < colorChannels; c++) if (line[x * channels + c] < 128) dark = true;
      if (dark) ink++;
    }
    previous = line;
  }
  return { width: header.width, height: header.height, ink, ratio: ink / (header.width * header.height) };
}

export function fixturePage(token) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Ardia smoke ${token}</title></head><body style="margin:0;background:#fff"><h1 id="smoke-marker" style="font:48px sans-serif;margin:40px">Ardia smoke ${token}</h1></body></html>`;
}

function run(command, args, { timeout = 60000, env, cwd } = {}) {
  return new Promise((done) => {
    execFile(command, args, { timeout, env, cwd, maxBuffer: 32 << 20, killSignal: "SIGKILL" }, (error, stdout, stderr) => done({ code: error ? (error.code ?? error.signal ?? 1) : 0, stdout: String(stdout), stderr: String(stderr), error }));
  });
}

async function fileInfo(path) {
  try {
    const info = await stat(path);
    return { mode: info.mode, isFile: info.isFile(), size: info.size };
  } catch {
    return null;
  }
}

async function readProcess(pid) {
  const [statText, cmdline, statusText] = await Promise.all([readFile(`/proc/${pid}/stat`, "utf8"), readFile(`/proc/${pid}/cmdline`), readFile(`/proc/${pid}/status`, "utf8")]);
  const parsed = parseStat(statText);
  if (!parsed) return null;
  const ns = {};
  for (const kind of ["user", "pid"]) ns[kind] = await readlink(`/proc/${pid}/ns/${kind}`).catch(() => null);
  return { pid, ...parsed, argv: commandLine(cmdline.toString("utf8")), status: parseStatus(statusText), ns };
}

async function processSnapshot() {
  const entries = (await readdir("/proc")).filter((name) => /^\d+$/.test(name));
  const processes = await Promise.all(entries.map((name) => readProcess(Number(name)).catch(() => null)));
  return processes.filter((proc) => proc && proc.state !== "Z");
}

function startFixtureServer(token) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url, at: Date.now() });
    if (request.url?.startsWith("/smoke")) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(fixturePage(token));
      return;
    }
    response.writeHead(404, { "content-type": "text/plain" });
    response.end("not found");
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      done({ server, requests, url: `http://127.0.0.1:${port}/smoke/${token}`, close: () => new Promise((closed) => { server.closeAllConnections?.(); server.close(() => closed()); }) });
    });
  });
}

class Smoke {
  constructor(options) {
    this.options = options;
    this.assertions = [];
    this.started = new Date().toISOString();
    this.packagePath = resolve(options.package);
    this.results = resolve(options.results);
    this.apps = [];
  }

  async record(name, body, { timeout = 60000 } = {}) {
    const started = Date.now();
    let entry;
    try {
      const detail = await withDeadline(Promise.resolve().then(body), timeout, name);
      entry = { name, ok: true, detail: detail ?? null, ms: Date.now() - started };
    } catch (error) {
      entry = { name, ok: false, detail: { error: errorText(error), ...(error?.detail ? { evidence: error.detail } : {}) }, ms: Date.now() - started };
    }
    this.assertions.push(entry);
    process.stderr.write(`[smoke] ${entry.ok ? "pass" : "FAIL"} ${name} (${entry.ms} ms)${entry.ok ? "" : `: ${entry.detail.error}`}\n`);
    return entry;
  }

  skip(name, reason) {
    if (this.assertions.some((a) => a.name === name)) return;
    this.assertions.push({ name, ok: false, detail: { error: `not run: ${reason}` }, ms: 0 });
  }

  async launch(label) {
    const extraArgs = [];
    const refused = launchRefusal(launchArguments({ scratch: this.profile, extensions: true, extraArgs }), launchEnvironment({ scratch: this.profile }));
    if (refused) throw new Error(refused);
    const app = await launchArdia({ executable: this.launcher, scratch: this.profile, extensions: true, extraArgs, label, startTimeout: 60000 });
    this.apps.push(app);
    return app;
  }

  async stopApp(app) {
    if (!app) return;
    await app.close({ graceful: !app.exited, timeout: 10000 }).catch(() => {});
  }

  async extract() {
    this.work = await mkdtemp(join(tmpdir(), "ardia-smoke-"));
    const into = join(this.work, "package");
    await mkdir(into);
    const result = await run("tar", ["-xJf", this.packagePath, "-C", into], { timeout: 180000 });
    if (result.code !== 0) throw new Error(`tar -xJf exited ${result.code}: ${result.stderr.slice(-400)}`);
    this.root = join(into, "ardia");
    this.launcher = join(this.root, "bin", "ardia");
    this.runtime = join(this.root, "lib", "ardia");
    this.chrome = join(this.runtime, "chrome");
    for (const path of [this.launcher, this.chrome, join(this.runtime, "ardia-ui", "index.html"), join(this.root, "install.sh")]) {
      if (!(await fileInfo(path))?.isFile) throw new Error(`the package has no ${path.slice(into.length + 1)}`);
    }
    this.profile = join(this.work, "profile");
    await mkdir(this.profile);
  }

  async ldd() {
    const result = await run("ldd", [this.chrome], { timeout: 30000 });
    if (result.code !== 0) throw new Error(`ldd exited ${result.code}: ${(result.stderr || result.stdout).slice(-400)}`);
    const missing = lddMissing(result.stdout);
    if (missing.length) throw Object.assign(new Error(`unresolved libraries: ${missing.join("; ")}`), { detail: { missing } });
    return { libraries: result.stdout.split("\n").filter((line) => line.includes("=>")).length };
  }

  async shellUi(shell) {
    const index = await readFile(join(this.runtime, "ardia-ui", "index.html"), "utf8");
    const bundled = [...index.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    if (!bundled.length) throw new Error("the packaged index.html has no module script");
    const assets = new Set(await readdir(join(this.runtime, "ardia-ui", "assets")));
    const page = await until(async () => {
      const state = await shell.eval(`(() => { const root = document.getElementById("root"); return { href: location.href, readyState: document.readyState, rootChildren: root?.childElementCount ?? -1, rootText: (root?.innerText ?? "").trim().length, windowNode: !!document.querySelector("[data-ardia-linux-window]"), modules: [...document.querySelectorAll('script[type="module"]')].map((s) => s.getAttribute("src")), styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((l) => l.getAttribute("href")), vite: !!document.querySelector('script[src*="@vite"]') || typeof globalThis.__vite_plugin_react_preamble_installed__ !== "undefined" }; })()`);
      return state.readyState === "complete" && state.rootChildren > 0 ? state : false;
    }, { timeout: 30000, label: "the shell document to load with content in #root" });
    const problems = [];
    if (!page.href.startsWith("chrome://ardia/")) problems.push(`the shell is at ${page.href}`);
    if (page.vite) problems.push("the shell loaded the Vite dev client");
    if (!page.windowNode) problems.push("no [data-ardia-linux-window] node");
    for (const src of bundled) if (!page.modules.includes(src)) problems.push(`the shell did not load the packaged module ${src} (it loaded ${page.modules.join(", ")})`);
    for (const src of [...page.modules, ...page.styles]) if (src.startsWith("/assets/") && !assets.has(src.slice("/assets/".length))) problems.push(`${src} is not in lib/ardia/ardia-ui/assets`);
    const served = [];
    await shell.session.send("Page.enable").catch(() => {});
    const { frameTree } = await shell.session.send("Page.getResourceTree");
    for (const src of [...new Set([...bundled, ...page.styles.filter((href) => href.startsWith("/assets/"))])]) {
      const url = new URL(src, page.href).href;
      const packaged = await readFile(join(this.runtime, "ardia-ui", src.replace(/^\//, ""))).catch(() => null);
      const resource = await shell.session.send("Page.getResourceContent", { frameId: frameTree.frame.id, url }).catch((error) => ({ error: errorText(error) }));
      const content = resource.error ? null : Buffer.from(resource.content, resource.base64Encoded ? "base64" : "utf8");
      const same = Boolean(packaged && content && sha256(packaged) === sha256(content));
      served.push({ url, bytes: content?.length ?? null, packagedBytes: packaged?.length ?? null, same, error: resource.error ?? null });
      if (!same) problems.push(`${url} as loaded is not byte for byte lib/ardia/ardia-ui${src}${resource.error ? ` (${resource.error})` : ""}`);
    }
    if (problems.length) throw Object.assign(new Error(problems.join("; ")), { detail: page });
    return { href: page.href, rootChildren: page.rootChildren, rootText: page.rootText, modules: page.modules, served };
  }

  async bootstrap(shell) {
    const info = await shell.eval(`(() => { const b = globalThis.__ardiaHost?.bootstrap; const s = b?.nativeModules?.ArdiaApp?.systemInfo; return s ? { appBuild: s.appBuild, appName: s.appName, appVersion: s.appVersion, bundleId: s.bundleId, osBuild: s.osBuild, arch: s.arch } : null; })()`);
    if (!info) throw new Error("__ardiaHost.bootstrap.nativeModules.ArdiaApp.systemInfo is missing");
    if (info.appBuild !== "linux-host") throw Object.assign(new Error(`appBuild is ${JSON.stringify(info.appBuild)}, not "linux-host"`), { detail: info });
    return info;
  }

  async nativeTab(app, shell) {
    const tabId = await shell.newTab(this.fixture.url);
    await shell.waitTabUrl(tabId, (url) => url === this.fixture.url, { timeout: 30000, label: "the new tab to commit the fixture URL" });
    const target = await app.pageLoaded(this.fixture.url, { timeout: 30000 });
    const session = await connectCdp(target.webSocketDebuggerUrl);
    try {
      let last;
      const page = await until(async () => {
        const state = last = await evaluate(session, `(() => { const n = document.getElementById("smoke-marker"); const r = n?.getBoundingClientRect(); const hit = r ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null; return { title: document.title, text: n?.innerText ?? null, host: typeof window.__ardiaHost, visibility: document.visibilityState, width: innerWidth, height: innerHeight, rect: r ? { width: r.width, height: r.height } : null, hit: hit === n || !!n?.contains(hit) }; })()`, { timeout: 5000, userGesture: false });
        return state.text && state.hit ? state : false;
      }, { timeout: 20000, label: "the fixture to be visible in the tab" }).catch((error) => { throw Object.assign(new Error(`${error.message}; last ${JSON.stringify(last)}`), { detail: last }); });
      const problems = [];
      const shot = await session.send("Page.captureScreenshot", { format: "png" }, { timeout: 10000 }).catch((error) => ({ error: errorText(error) }));
      let ink = null;
      if (shot.data) {
        const png = Buffer.from(shot.data, "base64");
        await writeFile(join(this.results, "native-tab.png"), png);
        try {
          ink = pngInk(png);
          if (ink.ink === 0) problems.push("the tab's screenshot is blank");
          else if (ink.ratio > 0.5) problems.push(`the tab's screenshot is mostly dark (${(ink.ratio * 100).toFixed(1)}%), not the white fixture`);
        } catch (error) {
          problems.push(`the tab's screenshot could not be read: ${errorText(error)}`);
        }
      } else problems.push(`Page.captureScreenshot failed: ${shot.error}`);
      if (page.text !== `Ardia smoke ${this.fixture.token}`) problems.push(`the marker reads ${JSON.stringify(page.text)}`);
      if (page.host !== "undefined") problems.push(`typeof window.__ardiaHost is ${page.host} in the web page`);
      if (!(page.rect?.width > 0 && page.rect?.height > 0)) problems.push(`the marker has no size: ${JSON.stringify(page.rect)}`);
      if (!this.fixture.requests.some((r) => r.url?.startsWith("/smoke"))) problems.push("the fixture server saw no request");
      if (problems.length) throw Object.assign(new Error(problems.join("; ")), { detail: page });
      return { tabId, targetId: target.id, ...page, screenshot: "native-tab.png", ink, requests: this.fixture.requests.length };
    } finally {
      await session.close().catch(() => {});
    }
  }

  async sandbox(app) {
    const rootPid = app.child.pid;
    let verdict;
    await until(async () => {
      verdict = sandboxVerdict(processTree(await processSnapshot(), rootPid), rootPid);
      return verdict.renderers.length >= 2 && verdict.ok;
    }, { timeout: 10000, interval: 250, label: "sandboxed renderers" }).catch(() => {});
    if (!verdict) throw new Error("could not read the process tree from /proc");
    if (verdict.renderers.length === 1) verdict = { ...verdict, ok: false, problems: [...verdict.problems, "only one renderer runs, so the shell and the fixture tab cannot both have been checked"] };
    if (!verdict.ok) throw Object.assign(new Error(verdict.problems.join("; ")), { detail: verdict });
    return verdict;
  }

  async contentBlocker(shell) {
    const blocker = join(this.runtime, "extensions", "ublock");
    const missing = [];
    for (const name of BLOCKER_FILES) if (!(await fileInfo(join(blocker, name)))?.isFile) missing.push(name);
    const bridge = (await readdir(BRIDGE_DIR).catch(() => [])).filter(Boolean);
    if (!bridge.length) missing.push(`the bridge sources in ${BRIDGE_DIR.pathname}`);
    for (const name of bridge) {
      const shipped = await readFile(join(blocker, name)).catch(() => null);
      const source = await readFile(new URL(name, BRIDGE_DIR));
      if (!shipped) missing.push(name);
      else if (!shipped.equals(source)) missing.push(`${name} (differs from engine/ardiacore-linux/content-blocker)`);
    }
    if (missing.length) throw new Error(`lib/ardia/extensions/ublock lacks ${missing.join(", ")}`);
    const manifest = JSON.parse(await readFile(join(blocker, "manifest.json"), "utf8"));
    if (typeof manifest.key !== "string" || manifest.manifest_version !== 2) throw new Error("the packaged manifest is not the keyed MV2 uBlock Origin build");
    let last;
    const state = await until(async () => {
      last = await shell.call("contentBlocker.state");
      if (last && !last.ok && /not installed|didn't load/.test(last.message)) throw Object.assign(new Error(`the content blocker reports: ${last.message}`), { fatal: true });
      return last?.ok && last.value?.stats?.ready && last.value.lists?.length > 0 ? last.value : false;
    }, { timeout: 60000, interval: 250, label: "the content blocker to report ready" }).catch((error) => {
      throw new Error(`${error.message}; last ${JSON.stringify(last?.value?.stats ?? last)}`);
    });
    return { version: manifest.version, bridge, enabled: state.enabled, stats: state.stats, lists: state.lists.map((l) => l.id ?? l.name).slice(0, 12) };
  }

  async quit(app, shell) {
    await shell.command("quit");
    await until(() => app.exited, { timeout: 30000, label: "Ardia to quit after the quit command" }).catch(async (error) => {
      const log = await app.logText();
      const prompt = log.split("\n").filter((line) => line.includes("[ardiacore] dialog (background run")).slice(-2);
      throw new Error(`${error.message}${prompt.length ? `; ${prompt.join(" | ")}` : ""}`);
    });
    const code = app.exitCode;
    await this.stopApp(app);
    if (code !== 0) throw new Error(`Ardia exited with ${code} after the quit command`);
    return code;
  }

  async restart(first) {
    const exitCode = await this.quit(first.app, first.shell);
    const before = this.fixture.requests.length;
    const app = await this.launch("relaunch");
    const shell = await app.mainShell({ timeout: 45000 });
    const tab = await until(async () => shell.state(`return Object.values(s.tabs).find((tab) => tab.url === ${js(this.fixture.url)}) ?? null;`), { timeout: 30000, label: "the fixture tab in the restored session", abort: () => app.exitReason() });
    const target = await app.pageLoaded(this.fixture.url, { timeout: 30000 });
    const session = await connectCdp(target.webSocketDebuggerUrl);
    let text;
    try {
      text = await until(() => evaluate(session, `document.getElementById("smoke-marker")?.innerText ?? null`, { timeout: 5000, userGesture: false }), { timeout: 15000, label: "the restored fixture content" });
    } finally {
      await session.close().catch(() => {});
    }
    if (text !== `Ardia smoke ${this.fixture.token}`) throw new Error(`the restored tab reads ${JSON.stringify(text)}`);
    return { app, shell, detail: { exitCode, restoredTab: tab.id, sameTab: tab.id === first.tabId, text, reloaded: this.fixture.requests.length > before } };
  }

  async stagedInstall() {
    const stage = join(this.work, "stage");
    await mkdir(stage);
    const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: "C", HOME: join(this.work, "install-home"), TMPDIR: this.work };
    const result = await run("bash", [join(this.root, "install.sh"), "--destdir", stage], { timeout: 120000, env, cwd: this.work });
    await writeFile(join(this.results, "install.log"), `${result.stdout}${result.stderr}`);
    if (result.code !== 0) throw new Error(`install.sh --destdir exited ${result.code}: ${result.stderr.slice(-400)}`);
    const entries = [];
    for (const { path, mode } of STAGED_FILES) entries.push({ path, expected: mode, actual: await fileInfo(join(stage, path)) });
    const problems = modeProblems(entries);
    const launcher = await readFile(join(stage, "usr/bin/ardia"), "utf8").catch(() => "");
    if (!launcher.includes('exec "/usr/lib/ardia/chrome"')) problems.push(`the staged launcher does not exec /usr/lib/ardia/chrome: ${JSON.stringify(launcher)}`);
    const desktop = await readFile(join(stage, "usr/share/applications/ardia.desktop"), "utf8").catch(() => "");
    if (!/^Exec=\/usr\/bin\/ardia /m.test(desktop)) problems.push("the staged desktop entry does not run /usr/bin/ardia");
    const policy = await readFile(join(stage, "usr/share/polkit-1/actions/dev.ardia.linux.policy")).catch(() => null);
    const packaged = await readFile(join(this.root, "share/polkit-1/actions/dev.ardia.linux.policy")).catch(() => null);
    if (!policy || !packaged || !policy.equals(packaged)) problems.push("the staged polkit policy differs from the package's");
    const chrome = await fileInfo(join(stage, "usr/lib/ardia/chrome"));
    const original = await fileInfo(this.chrome);
    if (chrome && original && chrome.size !== original.size) problems.push("the staged chrome differs in size from the package's");
    const stray = (await readdir(stage)).filter((name) => name !== "usr");
    if (stray.length) problems.push(`install.sh staged outside usr/: ${stray.join(", ")}`);
    if (problems.length) throw Object.assign(new Error(problems.join("; ")), { detail: entries });
    return { files: entries.map((e) => ({ path: e.path, mode: (e.actual.mode & 0o7777).toString(8) })) };
  }

  async collectLogs() {
    if (!this.profile) return;
    for (const name of await readdir(this.profile).catch(() => [])) {
      if (name.endsWith(".log") || name.endsWith("-command.json")) await copyFile(join(this.profile, name), join(this.results, name)).catch(() => {});
    }
  }

  async main() {
    await mkdir(this.results, { recursive: true });
    if (!(await fileInfo(this.packagePath))?.isFile) throw new Error(`no package at ${this.packagePath}`);
    try {
      await withDeadline(this.extract(), 200000, "extracting the package");
    } catch (error) {
      for (const name of ASSERTIONS) this.skip(name, `the package did not extract: ${errorText(error)}`);
      return;
    }
    await this.record("ldd", () => this.ldd());
    const token = nonce("smoke");
    this.fixture = { ...(await startFixtureServer(token)), token };
    let first = null;
    const launched = await this.record("shell-ui", async () => {
      const app = await this.launch("first");
      const shell = await app.mainShell({ timeout: 45000 });
      first = { app, shell };
      return this.shellUi(shell);
    }, { timeout: 120000 });
    if (!first) {
      for (const name of ASSERTIONS.slice(2, 7)) this.skip(name, `Ardia did not start: ${launched.detail.error}`);
    } else {
      await this.record("bootstrap", () => this.bootstrap(first.shell));
      await this.record("content-blocker", () => this.contentBlocker(first.shell), { timeout: 90000 });
      const tab = await this.record("native-tab", () => this.nativeTab(first.app, first.shell), { timeout: 90000 });
      if (tab.ok) first.tabId = tab.detail.tabId;
      await this.record("sandbox", () => this.sandbox(first.app), { timeout: 30000 });
      if (!tab.ok) this.skip("restart-restore", "the fixture tab did not open");
      else {
        let second = null;
        await this.record("restart-restore", async () => {
          second = await this.restart(first);
          return second.detail;
        }, { timeout: 150000 });
        await this.stopApp(second?.app);
      }
      await this.stopApp(first.app);
    }
    await this.record("staged-install", () => this.stagedInstall(), { timeout: 150000 });
  }

  async finish() {
    await closeAllApps({ graceful: false }).catch(() => {});
    await this.fixture?.close().catch(() => {});
    await this.collectLogs();
    this.assertions.sort((a, b) => ASSERTIONS.indexOf(a.name) - ASSERTIONS.indexOf(b.name));
    for (const name of ASSERTIONS) this.skip(name, "the run stopped before this check");
    const { ok } = summarize(this.assertions);
    const report = { ok, package: this.packagePath, started: this.started, finished: new Date().toISOString(), assertions: this.assertions };
    await mkdir(this.results, { recursive: true });
    await writeFile(join(this.results, "results.json"), `${JSON.stringify(report, null, 2)}\n`);
    if (this.work && !this.options.keep) await rm(this.work, { recursive: true, force: true }).catch(() => {});
    process.stdout.write(`${formatTable(this.assertions)}\n${ok ? "smoke passed" : "smoke FAILED"}: ${basename(this.packagePath)}${this.options.keep && this.work ? ` (kept ${this.work})` : ""}\n`);
    return ok;
  }
}

async function cli(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${errorText(error)}\n\n${USAGE}`);
    return 2;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (process.platform !== "linux") {
    process.stderr.write("smoke.mjs runs on Linux only\n");
    return 2;
  }
  const smoke = new Smoke(options);
  let stopping = false;
  const stop = async (reason) => {
    if (stopping) return;
    stopping = true;
    killAllAppsNow();
    process.stderr.write(`[smoke] stopping: ${reason}\n`);
    for (const name of ASSERTIONS) smoke.skip(name, reason);
    const ok = await withDeadline(smoke.finish(), 30000, "writing the results").catch(() => false);
    killAllAppsNow();
    process.exit(ok ? 0 : 1);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) process.once(signal, () => stop(`received ${signal}`));
  const deadline = setTimeout(() => stop(`the ${options.timeoutMs} ms deadline passed`), options.timeoutMs);
  try {
    await smoke.main();
  } catch (error) {
    process.stderr.write(`[smoke] ${errorText(error)}\n`);
    for (const name of ASSERTIONS) smoke.skip(name, errorText(error));
  }
  clearTimeout(deadline);
  if (stopping) return new Promise(() => {});
  const ok = await smoke.finish().catch((error) => {
    process.stderr.write(`[smoke] could not write results: ${errorText(error)}\n`);
    return false;
  });
  killAllAppsNow();
  return ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await cli(process.argv.slice(2));
}
