import { execFile, spawn } from "node:child_process";
import { closeSync, constants, openSync } from "node:fs";
import { access, chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { until } from "./util.mjs";
import { BTN_LEFT, BTN_MIDDLE, BTN_RIGHT, openVirtualPointer } from "./waylandPointer.mjs";

export const MOCKS = new URL("./mocks/", import.meta.url);
export const PORTAL_FRONTEND = "/usr/lib/xdg-desktop-portal";
const SCRUBBED = ["WAYLAND_DISPLAY", "DISPLAY", "SWAYSOCK", "I3SOCK", "HYPRLAND_INSTANCE_SIGNATURE", "XDG_SESSION_ID", "XDG_SEAT", "XDG_VTNR", "XDG_ACTIVATION_TOKEN", "DESKTOP_STARTUP_ID", "DBUS_SESSION_BUS_ADDRESS", "DBUS_SYSTEM_BUS_ADDRESS", "GNOME_KEYRING_CONTROL", "SSH_AUTH_SOCK", "GTK_IM_MODULE", "QT_IM_MODULE", "XMODIFIERS", "XAUTHORITY", "AT_SPI_BUS_ADDRESS", "PULSE_SERVER", "PIPEWIRE_REMOTE", "WAYLAND_SOCKET"];

export function toolEnvironment(base = process.env) {
  const prefix = base.ARDIA_ACCEPTANCE_TOOLS;
  const env = { ...base };
  if (!prefix) return env;
  env.PATH = [join(prefix, "usr", "bin"), base.PATH].filter(Boolean).join(delimiter);
  env.LD_LIBRARY_PATH = [join(prefix, "usr", "lib"), base.LD_LIBRARY_PATH].filter(Boolean).join(delimiter);
  return env;
}

export function privateEnvironment(base = process.env, extra = {}) {
  const env = toolEnvironment(base);
  for (const key of SCRUBBED) delete env[key];
  return { ...env, ...extra };
}

async function which(name, path) {
  if (name.startsWith("/")) return access(name, constants.X_OK).then(() => name, () => null);
  for (const dir of (path ?? "").split(delimiter).filter(Boolean)) {
    const candidate = join(dir, name);
    if (await access(candidate, constants.X_OK).then(() => true, () => false)) return candidate;
  }
  return null;
}

function runFile(command, args, { env, timeout = 10000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { env, timeout, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.message = `${command} ${args.join(" ")}: ${error.message.split("\n")[0]}${stderr ? `; ${String(stderr).trim().slice(-400)}` : ""}`;
        reject(error);
      } else resolve(String(stdout));
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

export async function pythonHasDbusmock(env) {
  return runFile("python3", ["-c", "import dbusmock, dbus, gi"], { env, timeout: 10000 }).then(() => true, () => false);
}

export async function pythonSitePackages(env) {
  const prefix = env.ARDIA_ACCEPTANCE_TOOLS;
  if (!prefix) return null;
  const lib = join(prefix, "usr", "lib");
  const names = await readdir(lib).catch(() => []);
  const python = names.find((name) => /^python3\.\d+$/.test(name));
  return python ? join(lib, python, "site-packages") : null;
}

export async function desktopTools(base = process.env) {
  const env = toolEnvironment(base);
  const site = await pythonSitePackages(env);
  if (site) env.PYTHONPATH = [site, base.PYTHONPATH].filter(Boolean).join(delimiter);
  const found = {};
  for (const [key, name] of Object.entries({ sway: "sway", swaymsg: "swaymsg", xvfb: "Xvfb", xdotool: "xdotool", grim: "grim", xkbcli: "xkbcli", openbox: "openbox", xgrab: "imlib2_grab", dbusDaemon: "dbus-daemon", keyring: "gnome-keyring-daemon", fcitx5: "fcitx5", python: "python3", portal: PORTAL_FRONTEND, xprop: "xprop" })) found[key] = await which(name, env.PATH);
  found.dbusmock = found.python ? await pythonHasDbusmock(env) : false;
  return { env, ...found };
}

export function missingTools(tools, needed) {
  return needed.filter((name) => !tools[name]);
}

const GROUPS = new Set();
const EMERGENCIES = new Set();

export function trackGroup(proc) {
  const pid = proc.child.pid;
  if (!pid) return proc;
  GROUPS.add(proc);
  proc.child.once("exit", () => {
    setTimeout(() => {
      if (!groupAlive(pid)) GROUPS.delete(proc);
    }, 200).unref();
  });
  return proc;
}

export function onEmergency(stop) {
  EMERGENCIES.add(stop);
  return () => EMERGENCIES.delete(stop);
}

export function trackedGroups() {
  return [...GROUPS].map((proc) => proc.child.pid);
}

export function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function killDesktopNow() {
  for (const stop of [...EMERGENCIES]) {
    try { stop(); } catch {}
  }
  EMERGENCIES.clear();
  for (const proc of [...GROUPS]) {
    try { process.kill(-proc.child.pid, "SIGKILL"); } catch {}
    GROUPS.delete(proc);
  }
}

function spawnLogged(command, args, { env, logPath, stdio }) {
  const log = openSync(logPath, "a");
  const child = spawn(command, args, { env, stdio: stdio ?? ["ignore", log, log], detached: true });
  closeSync(log);
  const state = { exited: false, code: null };
  child.once("exit", (code, signal) => { state.exited = true; state.code = code ?? signal; });
  child.once("error", (error) => { state.exited = true; state.code = error.message; });
  return trackGroup({ child, state });
}

export async function stopGroup(proc, { grace = 3000 } = {}) {
  const { child, state } = proc;
  if (!child.pid) return;
  try { process.kill(-child.pid, "SIGTERM"); } catch {}
  for (let waited = 0; (!state.exited || groupAlive(child.pid)) && waited < grace; waited += 50) await delay(50);
  try { process.kill(-child.pid, "SIGKILL"); } catch {}
  for (let waited = 0; (!state.exited || groupAlive(child.pid)) && waited < 2000; waited += 50) await delay(50);
  GROUPS.delete(proc);
}

export function busConfig({ type = "session", socket, serviceDir }) {
  return `<!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-Bus Bus Configuration 1.0//EN" "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
<busconfig>
  <type>${type}</type>
  <listen>unix:path=${socket}</listen>
  <auth>EXTERNAL</auth>
  <servicedir>${serviceDir}</servicedir>
  <policy context="default">
    <allow send_destination="*" eavesdrop="true"/>
    <allow eavesdrop="true"/>
    <allow own="*"/>
  </policy>
</busconfig>
`;
}

export async function startBus(dir, { name, type = "session", env, services = {} }) {
  const socket = join(dir, `${name}-bus`);
  const serviceDir = join(dir, `${name}-services`);
  await mkdir(serviceDir, { recursive: true });
  for (const [service, exec] of Object.entries(services)) await writeFile(join(serviceDir, `${service}.service`), `[D-BUS Service]\nName=${service}\nExec=${exec}\n`);
  const config = join(dir, `${name}-bus.conf`);
  await writeFile(config, busConfig({ type, socket, serviceDir }));
  const proc = spawnLogged("dbus-daemon", ["--nofork", "--nopidfile", `--config-file=${config}`], { env, logPath: join(dir, `${name}-bus.log`) });
  await until(() => access(socket).then(() => true, () => false), { timeout: 10000, label: `the private ${name} bus`, abort: () => (proc.state.exited ? `dbus-daemon exited (${proc.state.code})` : null) });
  return { address: `unix:path=${socket}`, socket, serviceDir, stop: () => stopGroup(proc) };
}

export function swayConfig({ outputs = 1, width = 1920, height = 1080, extra = [] } = {}) {
  const lines = [];
  for (let index = 1; index <= outputs; index++) lines.push(`output HEADLESS-${index} resolution ${width}x${height} position ${(index - 1) * width} 0`);
  lines.push("xwayland disable", "focus_on_window_activation focus", "focus_follows_mouse no", "default_border none", "seat seat0 fallback true", ...extra);
  return `${lines.join("\n")}\n`;
}

export function flattenTree(node, output = null, workspace = null, out = []) {
  const here = node.type === "output" ? node.name : output;
  const space = node.type === "workspace" ? node.name : workspace;
  if ((node.type === "con" || node.type === "floating_con") && (node.pid || node.app_id || node.window_properties)) {
    out.push({ id: node.id, pid: node.pid ?? null, appId: node.app_id ?? node.window_properties?.class ?? null, title: node.name ?? "", focused: !!node.focused, fullscreen: (node.fullscreen_mode ?? 0) > 0, output: here, workspace: space, rect: node.rect, visible: node.visible ?? null, floating: node.type === "floating_con" });
  }
  for (const child of [...(node.nodes ?? []), ...(node.floating_nodes ?? [])]) flattenTree(child, here, space, out);
  return out;
}

export const SOCKET_PATH_MAX = 107;

export async function privateRuntime(dir) {
  const inside = join(dir, "runtime");
  const longest = join(inside, "sway-ipc.4294967295.4294967295.sock");
  const runtime = longest.length <= SOCKET_PATH_MAX ? inside : await mkdtemp(join(tmpdir(), "ardia-rt-"));
  await mkdir(runtime, { recursive: true });
  await chmod(runtime, 0o700);
  return { runtime, temporary: runtime !== inside };
}

async function startSway(dir, { tools, env, outputs }) {
  const { runtime, temporary } = await privateRuntime(dir);
  const config = join(dir, "sway.conf");
  await writeFile(config, swayConfig({ outputs: 1 }));
  const swayEnv = { ...env, XDG_RUNTIME_DIR: runtime, WLR_BACKENDS: "headless", WLR_LIBINPUT_NO_DEVICES: "1", WLR_RENDERER: "pixman", WLR_HEADLESS_OUTPUTS: "1" };
  const proc = spawnLogged(tools.sway, ["-c", config], { env: swayEnv, logPath: join(dir, "sway.log") });
  const abort = () => (proc.state.exited ? `sway exited (${proc.state.code}); log ${join(dir, "sway.log")}` : null);
  const display = await until(async () => (await readdir(runtime)).find((n) => /^wayland-\d+$/.test(n)) ?? false, { timeout: 15000, label: "the private sway's Wayland socket", abort });
  const ipc = await until(async () => (await readdir(runtime)).find((n) => n.startsWith("sway-ipc.")) ?? false, { timeout: 10000, label: "the private sway's IPC socket", abort });
  const clientEnv = { ...env, XDG_RUNTIME_DIR: runtime, WAYLAND_DISPLAY: display, SWAYSOCK: join(runtime, ipc) };
  const msg = async (args, options) => runFile(tools.swaymsg, ["-r", ...args], { env: clientEnv, ...options });
  for (let index = 2; index <= outputs; index++) {
    await msg(["create_output"]);
    await msg(["output", `HEADLESS-${index}`, "resolution", "1920x1080", "position", `${(index - 1) * 1920}`, "0"]);
  }
  return { proc, runtime, temporary, display, clientEnv, msg };
}

async function startXvfb(dir, { tools, env }) {
  const logPath = join(dir, "xvfb.log");
  const log = openSync(logPath, "a");
  const child = spawn(tools.xvfb, ["-displayfd", "3", "-screen", "0", "1920x1080x24", "-nolisten", "tcp", "-noreset", "+extension", "XTEST"], { env, stdio: ["ignore", log, log, "pipe"], detached: true });
  closeSync(log);
  const state = { exited: false, code: null };
  trackGroup({ child, state });
  child.once("exit", (code, signal) => { state.exited = true; state.code = code ?? signal; });
  let text = "";
  child.stdio[3].on("data", (chunk) => { text += chunk; });
  const number = await until(() => (/\d+\n/.test(text) ? text.trim() : false), { timeout: 10000, label: "Xvfb's display number", abort: () => (state.exited ? `Xvfb exited (${state.code}); log ${logPath}` : null) });
  return { proc: { child, state }, display: `:${number}` };
}

export async function startDesktop(dir, { tools, outputs = 1, x11 = false, compositor = true, system = true, services = {}, systemServices = {}, home, extraEnv = {} } = {}) {
  tools ??= await desktopTools();
  await mkdir(dir, { recursive: true });
  const homeDir = home ?? join(dir, "home");
  await mkdir(homeDir, { recursive: true });
  const base = privateEnvironment(tools.env, { HOME: homeDir, XDG_CONFIG_HOME: join(homeDir, ".config"), XDG_DATA_HOME: join(homeDir, ".local", "share"), XDG_CACHE_HOME: join(homeDir, ".cache"), XDG_STATE_HOME: join(homeDir, ".local", "state"), XDG_CURRENT_DESKTOP: "ardia-acceptance", XDG_SESSION_TYPE: x11 ? "x11" : "wayland", ...extraEnv });
  const stops = [];
  const desktop = { dir, tools, home: homeDir, kind: x11 ? "x11" : "sway", mocks: [] };
  try {
    const session = await startBus(dir, { name: "session", env: base, services });
    stops.push(session.stop);
    const systemBus = system ? await startBus(dir, { name: "system", type: "system", env: base, services: systemServices }) : null;
    if (systemBus) stops.push(systemBus.stop);
    const busEnv = { DBUS_SESSION_BUS_ADDRESS: session.address, ...(systemBus ? { DBUS_SYSTEM_BUS_ADDRESS: systemBus.address } : {}) };
    desktop.session = session;
    desktop.system = systemBus;
    if (!compositor) {
      const runtime = join(dir, "runtime");
      await mkdir(runtime, { recursive: true });
      await chmod(runtime, 0o700);
      desktop.kind = "buses";
      desktop.runtime = runtime;
      desktop.env = { ...base, ...busEnv, XDG_RUNTIME_DIR: runtime };
    } else if (x11) {
      const runtime = join(dir, "runtime");
      await mkdir(runtime, { recursive: true });
      await chmod(runtime, 0o700);
      const xvfb = await startXvfb(dir, { tools, env: base });
      stops.push(() => stopGroup(xvfb.proc));
      if (tools.openbox) {
        const prefix = tools.env.ARDIA_ACCEPTANCE_TOOLS;
        const wmEnv = { ...base, ...busEnv, DISPLAY: xvfb.display, ...(prefix ? { XDG_CONFIG_DIRS: [join(prefix, "etc", "xdg"), "/etc/xdg"].join(delimiter), XDG_DATA_DIRS: [join(prefix, "usr", "share"), "/usr/local/share", "/usr/share"].join(delimiter) } : {}) };
        const wm = spawnLogged(tools.openbox, ["--sm-disable"], { env: wmEnv, logPath: join(dir, "openbox.log") });
        stops.push(() => stopGroup(wm));
        await until(async () => /_NET_SUPPORTING_WM_CHECK\(WINDOW\)/.test(await runFile("xprop", ["-root", "_NET_SUPPORTING_WM_CHECK"], { env: { ...base, DISPLAY: xvfb.display } }).catch(() => "")), { timeout: 10000, label: "openbox on the private X display", abort: () => (wm.state.exited ? `openbox exited (${wm.state.code})` : null) });
        desktop.windowManager = "openbox";
      }
      desktop.display = xvfb.display;
      desktop.runtime = runtime;
      desktop.env = { ...base, ...busEnv, XDG_RUNTIME_DIR: runtime, DISPLAY: xvfb.display };
    } else {
      const sway = await startSway(dir, { tools, env: { ...base, ...busEnv }, outputs });
      stops.push(() => stopGroup(sway.proc));
      if (sway.temporary) stops.push(() => rm(sway.runtime, { recursive: true, force: true }));
      desktop.sway = sway;
      desktop.runtime = sway.runtime;
      desktop.display = sway.display;
      desktop.env = { ...base, ...busEnv, ...sway.clientEnv };
    }
  } catch (error) {
    for (const stop of stops.reverse()) await stop().catch(() => {});
    throw error;
  }
  desktop.launchEnv = (extra = {}) => ({ ...desktop.env, ...extra });
  desktop.run = (command, args, options = {}) => runFile(command, args, { env: { ...desktop.env, ...(options.env ?? {}) }, timeout: options.timeout ?? 10000, input: options.input });
  desktop.stopped = false;
  desktop.spawn = (command, args, { name = command.split("/").pop(), env = {}, stdio } = {}) => {
    if (desktop.stopped) throw new Error(`the desktop session in ${dir} was stopped; refusing to start ${name}`);
    const proc = spawnLogged(command, args, { env: { ...desktop.env, ...env }, logPath: join(dir, `${name}.log`), stdio });
    stops.push(() => stopGroup(proc));
    return proc;
  };
  desktop.onStop = (stop) => (desktop.stopped ? void Promise.resolve().then(stop).catch(() => {}) : stops.push(stop));
  if (desktop.sway) {
    desktop.keyboard = await openVirtualKeyboard(desktop);
    desktop.pointer = await openVirtualPointer({ runtime: desktop.runtime, display: desktop.display, width: 1920 * outputs, height: 1080 });
    stops.push(() => desktop.pointer.close());
    Object.assign(desktop, swayDriver(desktop));
    await until(async () => {
      const seat = JSON.parse(await desktop.msg(["-t", "get_seats"]))[0];
      const types = new Set((seat?.devices ?? []).map((device) => device.type));
      return types.has("pointer") && types.has("keyboard");
    }, { timeout: 5000, label: "the private seat's keyboard and pointer" });
  } else if (desktop.kind === "x11") Object.assign(desktop, x11Driver(desktop));
  desktop.stop = async () => {
    desktop.stopped = true;
    for (const stop of stops.splice(0).reverse()) await stop().catch(() => {});
  };
  return desktop;
}

const VIRTUAL_KEYBOARD = new URL("./tools/virtual_keyboard.py", import.meta.url);

async function openVirtualKeyboard(desktop) {
  const proc = desktop.spawn("python3", ["-I", VIRTUAL_KEYBOARD.pathname, desktop.runtime, desktop.display], { name: "virtual-keyboard", stdio: ["pipe", "pipe", "pipe"] });
  const { child } = proc;
  let buffer = "";
  const waiting = [];
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      waiting.shift()?.(JSON.parse(line));
    }
  });
  const next = () => new Promise((resolve) => waiting.push(resolve));
  const ready = next();
  await until(async () => (await Promise.race([ready, delay(100).then(() => null)])) ?? false, { timeout: 10000, label: "the virtual keyboard", abort: () => (proc.state.exited ? `the virtual keyboard exited: ${stderr.trim()}` : null) });
  let chain = Promise.resolve();
  return {
    send(request) {
      const result = chain.then(async () => {
        if (proc.state.exited) throw new Error(`the virtual keyboard exited: ${stderr.trim()}`);
        const reply = next();
        child.stdin.write(`${JSON.stringify(request)}\n`);
        const answer = await Promise.race([reply, delay(30000).then(() => ({ ok: false, error: "no answer in 30 s" }))]);
        if (!answer.ok) throw new Error(`virtual keyboard ${request.op}: ${answer.error}`);
      });
      chain = result.catch(() => {});
      return result;
    },
  };
}

const BUTTONS = { left: BTN_LEFT, right: BTN_RIGHT, middle: BTN_MIDDLE };

function swayDriver(desktop) {
  const { msg } = desktop.sway;
  const driver = {
    msg,
    async tree() {
      return JSON.parse(await msg(["-t", "get_tree"]));
    },
    async outputs() {
      return JSON.parse(await msg(["-t", "get_outputs"])).map((o) => ({ name: o.name, rect: o.rect, focused: o.focused, active: o.active }));
    },
    async windows() {
      return flattenTree(await driver.tree());
    },
    async focused() {
      return (await driver.windows()).find((w) => w.focused) ?? null;
    },
    async command(text) {
      const reply = JSON.parse(await msg([text]));
      const failed = reply.find((r) => !r.success);
      if (failed) throw new Error(`sway "${text}": ${failed.error}`);
      return reply;
    },
    async key(combo) {
      await desktop.keyboard.send({ op: "combo", combo });
    },
    async type(text, { delay: pause = 0.02 } = {}) {
      await desktop.keyboard.send({ op: "type", text, delay: pause });
    },
    async keyDown(key) {
      await desktop.keyboard.send({ op: "down", key });
    },
    async tap(key) {
      await desktop.keyboard.send({ op: "tap", key });
    },
    async keymap({ layout = "us", variant = "", options = "" } = {}) {
      await desktop.keyboard.send({ op: "keymap", layout, variant, options });
    },
    async keyUp(key) {
      await desktop.keyboard.send({ op: "up", key });
    },
    async pointerMove(x, y) {
      await desktop.pointer.move(x, y);
    },
    async pointerPress(button = "left") {
      await desktop.pointer.button(BUTTONS[button] ?? button, true);
    },
    async pointerRelease(button = "left") {
      await desktop.pointer.button(BUTTONS[button] ?? button, false);
    },
    async click(x, y, button = "left") {
      await driver.pointerMove(x, y);
      await delay(80);
      await driver.pointerPress(button);
      await delay(60);
      await driver.pointerRelease(button);
    },
    async scroll(dy, dx = 0) {
      await desktop.pointer.scroll(dy, dx);
    },
    async swipe(x, y, distance, { steps = 24, interval = 12 } = {}) {
      await driver.pointerMove(x, y);
      await delay(120);
      for (const step of swipeSteps(distance, steps)) {
        await desktop.pointer.fingerScroll(step);
        await delay(interval);
      }
      await desktop.pointer.fingerLift();
    },
    async drag(from, to, { steps = 12, hold = 150 } = {}) {
      await driver.pointerMove(from.x, from.y);
      await driver.pointerPress();
      await delay(hold);
      for (let i = 1; i <= steps; i++) {
        await driver.pointerMove(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
        await delay(30);
      }
      await delay(hold);
      await driver.pointerRelease();
    },
    async screenshot(file, { output } = {}) {
      if (!desktop.tools.grim) return null;
      await desktop.run(desktop.tools.grim, [...(output ? ["-o", output] : []), file], { timeout: 20000 });
      return file;
    },
    async capture({ output } = {}) {
      if (!desktop.tools.grim) throw new Error("grim is not installed");
      const file = join(desktop.dir, `capture-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.ppm`);
      await desktop.run(desktop.tools.grim, ["-t", "ppm", ...(output ? ["-o", output] : []), file], { timeout: 20000 });
      const image = parsePpm(await readFile(file));
      await rm(file, { force: true });
      return image;
    },
    async raise(window) {
      await driver.command(`[con_id=${window.id}] focus`);
    },
    async focusWindow(id) {
      await driver.command(`[con_id=${id}] focus`);
    },
  };
  return driver;
}

function x11Driver(desktop) {
  const xdotool = (args, options) => desktop.run(desktop.tools.xdotool, args, options);
  const driver = {
    xdotool,
    async windows() {
      const ids = (await xdotool(["search", "--onlyvisible", "--name", "."]).catch(() => "")).split("\n").filter(Boolean);
      const active = await driver.activeId();
      const out = [];
      for (const id of ids) {
        const title = (await xdotool(["getwindowname", id]).catch(() => "")).trim();
        const pid = Number((await xdotool(["getwindowpid", id]).catch(() => "")).trim()) || null;
        const geometry = await xdotool(["getwindowgeometry", "--shell", id]).catch(() => "");
        const g = Object.fromEntries(geometry.split("\n").filter(Boolean).map((line) => line.split("=")));
        out.push({ id, pid, title, focused: id === active, fullscreen: false, output: "X11", rect: { x: Number(g.X), y: Number(g.Y), width: Number(g.WIDTH), height: Number(g.HEIGHT) } });
      }
      return out;
    },
    async raise(window) {
      await xdotool(["windowactivate", "--sync", String(window.id)], { timeout: 10000 }).catch(() => xdotool(["windowraise", String(window.id)]));
    },
    async activeId() {
      return (await xdotool(["getwindowfocus", "-f"]).catch(() => "")).trim() || null;
    },
    async focused() {
      const id = await driver.activeId();
      if (!id) return null;
      return (await driver.windows()).find((w) => w.id === id) ?? { id, focused: true };
    },
    async key(combo) {
      await xdotool(["key", "--clearmodifiers", combo]);
    },
    async type(text) {
      await xdotool(["type", "--delay", "40", text]);
    },
    async pointerMove(x, y) {
      await xdotool(["mousemove", String(Math.round(x)), String(Math.round(y))]);
    },
    async pointerPress(button = 1) {
      await xdotool(["mousedown", String(button)]);
    },
    async pointerRelease(button = 1) {
      await xdotool(["mouseup", String(button)]);
    },
    async click(x, y, button = 1) {
      await driver.pointerMove(x, y);
      await delay(60);
      await xdotool(["click", String(button)]);
    },
    async screenshot(file) {
      if (!desktop.tools.xgrab) return null;
      await desktop.run(desktop.tools.xgrab, [file], { timeout: 20000 });
      return file;
    },
    async keyDown(key) {
      await xdotool(["keydown", key]);
    },
    async tap(key) {
      await xdotool(["key", { return: "Return", enter: "Return", backspace: "BackSpace", escape: "Escape", tab: "Tab", space: "space" }[key] ?? key]);
    },
    async keyUp(key) {
      await xdotool(["keyup", key]);
    },
  };
  return driver;
}

export function swipeSteps(distance, steps) {
  const weights = Array.from({ length: steps }, (_, i) => Math.sin((Math.PI * (i + 0.5)) / steps));
  const total = weights.reduce((sum, w) => sum + w, 0);
  return weights.map((w) => (distance * w) / total);
}

export function parsePpm(buffer) {
  let offset = 0;
  const fields = [];
  while (fields.length < 4) {
    while (/\s/.test(String.fromCharCode(buffer[offset]))) offset++;
    if (buffer[offset] === 0x23) {
      while (buffer[offset] !== 0x0a) offset++;
      continue;
    }
    let token = "";
    while (!/\s/.test(String.fromCharCode(buffer[offset]))) token += String.fromCharCode(buffer[offset++]);
    fields.push(token);
  }
  offset++;
  if (fields[0] !== "P6" || fields[3] !== "255") throw new Error(`unsupported image ${fields.join(" ")}`);
  const width = Number(fields[1]);
  const height = Number(fields[2]);
  return { width, height, data: buffer.subarray(offset, offset + width * height * 3) };
}

export function changedCells(before, after, { threshold = 24, cell = 16, fill = 0.25 } = {}) {
  if (before.width !== after.width || before.height !== after.height) throw new Error("captures differ in size");
  const columns = Math.ceil(before.width / cell);
  const rows = Math.ceil(before.height / cell);
  const grid = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      let changed = 0;
      let total = 0;
      for (let y = row * cell; y < Math.min((row + 1) * cell, before.height); y++) {
        for (let x = column * cell; x < Math.min((column + 1) * cell, before.width); x++) {
          const i = (y * before.width + x) * 3;
          total++;
          if (Math.abs(before.data[i] - after.data[i]) + Math.abs(before.data[i + 1] - after.data[i + 1]) + Math.abs(before.data[i + 2] - after.data[i + 2]) >= threshold) changed++;
        }
      }
      if (changed / total >= fill) grid[row * columns + column] = 1;
    }
  }
  return { grid, columns, rows, cell };
}

export function regions({ grid, columns, rows, cell }, { gap = 2 } = {}) {
  const seen = new Uint8Array(grid.length);
  const found = [];
  for (let start = 0; start < grid.length; start++) {
    if (!grid[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let minC = Infinity, minR = Infinity, maxC = -1, maxR = -1, cells = 0;
    while (stack.length) {
      const index = stack.pop();
      const r = Math.floor(index / columns);
      const c = index % columns;
      cells++;
      minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r);
      for (let dr = -gap; dr <= gap; dr++) {
        for (let dc = -gap; dc <= gap; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= columns) continue;
          const next = nr * columns + nc;
          if (grid[next] && !seen[next]) { seen[next] = 1; stack.push(next); }
        }
      }
    }
    found.push({ x: minC * cell, y: minR * cell, width: (maxC - minC + 1) * cell, height: (maxR - minR + 1) * cell, cells });
  }
  return found.sort((a, b) => b.width * b.height - a.width * a.height);
}

export function changedRegion(before, after, options) {
  return regions(changedCells(before, after, options), options)[0] ?? null;
}

export async function writePpm(file, image) {
  await writeFile(file, Buffer.concat([Buffer.from(`P6\n${image.width} ${image.height}\n255\n`), image.data]));
}

export async function readLog(desktop, name) {
  return readFile(join(desktop.dir, `${name}.log`), "utf8").catch(() => "");
}
