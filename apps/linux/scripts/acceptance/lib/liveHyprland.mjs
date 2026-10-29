import { execFile, execFileSync } from "node:child_process";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { desktopTools, onEmergency, startDesktop } from "./desktop.mjs";
import { ScenarioAbort } from "./scenario.mjs";
import { BTN_LEFT, BTN_MIDDLE, BTN_RIGHT, openVirtualPointer } from "./waylandPointer.mjs";
import { until } from "./util.mjs";

export const LIVE_WORKSPACE = 9;
const BUTTONS = { left: BTN_LEFT, right: BTN_RIGHT, middle: BTN_MIDDLE };
const VIRTUAL_KEYBOARD = new URL("./tools/virtual_keyboard.py", import.meta.url).pathname;

export class LiveGuardError extends ScenarioAbort {}

export function liveRequest(env = process.env) {
  const signature = env.ARDIA_ACCEPTANCE_LIVE_HYPRLAND;
  if (!signature) return null;
  const uid = process.getuid?.() ?? 1000;
  return { signature, display: env.ARDIA_ACCEPTANCE_LIVE_WAYLAND ?? "wayland-1", runtime: env.ARDIA_ACCEPTANCE_LIVE_RUNTIME ?? `/run/user/${uid}` };
}

const hyprctlEnv = (request) => ({ PATH: process.env.PATH, HYPRLAND_INSTANCE_SIGNATURE: request.signature, XDG_RUNTIME_DIR: request.runtime });

function hyprctl(request, args) {
  return new Promise((resolve, reject) => {
    execFile("hyprctl", args, { env: hyprctlEnv(request), timeout: 10000 }, (error, stdout) => (error ? reject(error) : resolve(String(stdout))));
  });
}

const json = async (request, what) => JSON.parse(await hyprctl(request, ["-j", what]));

export function layoutBox(monitors) {
  const minX = Math.min(...monitors.map((m) => m.x));
  const minY = Math.min(...monitors.map((m) => m.y));
  const maxX = Math.max(...monitors.map((m) => m.x + m.width));
  const maxY = Math.max(...monitors.map((m) => m.y + m.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function pointInside(point, rect) {
  return point.x >= rect.x && point.y >= rect.y && point.x < rect.x + rect.width && point.y < rect.y + rect.height;
}

export function createGuard({ activeWorkspace, focusedWindow, windows }) {
  let tripped = null;
  const refuse = (message) => {
    tripped ??= message;
    throw new LiveGuardError(`live session input stopped: ${message}`);
  };
  const onWorkspace = async (what) => {
    if (tripped) refuse(tripped);
    const workspace = await activeWorkspace();
    if (workspace !== LIVE_WORKSPACE) refuse(`refusing to ${what}: workspace ${workspace} is active, not ${LIVE_WORKSPACE}`);
  };
  return {
    get tripped() {
      return tripped;
    },
    async focus(what) {
      await onWorkspace(what);
      const window = await focusedWindow();
      if (!window || window.workspace !== LIVE_WORKSPACE) refuse(`refusing to ${what}: the focused window (${window?.title ?? "none"}) isn't on workspace ${LIVE_WORKSPACE}`);
      return window;
    },
    async point(what, point) {
      await onWorkspace(what);
      const target = (await windows()).find((w) => w.workspace === LIVE_WORKSPACE && pointInside(point, w.layout));
      if (!target) refuse(`refusing to ${what} at ${point.x},${point.y}: no workspace-${LIVE_WORKSPACE} window is there`);
      return target;
    },
  };
}

export async function openLiveHyprland(t, request) {
  const tools = await desktopTools();
  const dir = await t.scratch("live-hyprland");
  const buses = await startDesktop(join(dir, "buses"), { tools, compositor: false });
  t.defer(() => buses.stop());
  const previous = Number((await json(request, "activeworkspace")).id);
  const occupied = (await json(request, "workspaces")).find((w) => w.id === LIVE_WORKSPACE && w.windows > 0);
  if (occupied) throw new Error(`workspace ${LIVE_WORKSPACE} already has ${occupied.windows} windows; refusing to share it`);
  const monitors = await json(request, "monitors");
  const monitor = monitors.find((m) => m.focused) ?? monitors[0];
  const layout = layoutBox(monitors);
  const restore = `hl.dsp.focus({ workspace = ${previous} })`;
  const forget = onEmergency(() => execFileSync("hyprctl", ["dispatch", restore], { env: hyprctlEnv(request), timeout: 5000, stdio: "ignore" }));
  t.defer(async () => {
    forget();
    await hyprctl(request, ["dispatch", restore]).catch(() => {});
  });
  await hyprctl(request, ["dispatch", `hl.dsp.focus({ workspace = ${LIVE_WORKSPACE} })`]);
  const display = "wayland-live";
  await symlink(join(request.runtime, request.display), join(buses.runtime, display));
  const clientEnv = { WAYLAND_DISPLAY: display, XDG_RUNTIME_DIR: buses.runtime };
  const liveEnv = { ...clientEnv, XDG_CURRENT_DESKTOP: "Hyprland", XDG_SESSION_TYPE: "wayland" };
  const toWindow = (c) => ({ id: c.address, pid: c.pid, appId: c.class, title: c.title, focused: false, fullscreen: c.fullscreen > 0, fullscreenMode: c.fullscreen, floating: c.floating, output: c.monitor, workspace: c.workspace?.id, rect: { x: c.at[0] - monitor.x, y: c.at[1] - monitor.y, width: c.size[0], height: c.size[1] }, layout: { x: c.at[0], y: c.at[1], width: c.size[0], height: c.size[1] } });
  const live = {
    kind: "hyprland",
    dir,
    tools,
    home: buses.home,
    session: buses.session,
    system: buses.system,
    runtime: buses.runtime,
    display,
    monitor: monitor.name,
    env: { ...buses.env, ...liveEnv },
    run: (command, args, options = {}) => buses.run(command, args, { ...options, env: { ...liveEnv, ...(options.env ?? {}) } }),
    spawn: (command, args, options = {}) => buses.spawn(command, args, { ...options, env: { ...liveEnv, ...(options.env ?? {}) } }),
    onStop: buses.onStop,
    async windows() {
      return (await json(request, "clients")).filter((c) => c.workspace?.id === LIVE_WORKSPACE).map(toWindow);
    },
    async focused() {
      const active = await json(request, "activewindow").catch(() => null);
      if (!active?.address || active.workspace?.id !== LIVE_WORKSPACE) return null;
      return { ...toWindow(active), focused: true };
    },
    async raise(window) {
      await hyprctl(request, ["dispatch", `hl.dsp.focus({ window = "address:${window.id}" })`]);
    },
    async dispatch(lua) {
      return hyprctl(request, ["dispatch", lua]);
    },
    async screenshot(file) {
      await buses.run(tools.grim, ["-o", monitor.name, file], { env: clientEnv, timeout: 20000 });
      return file;
    },
  };
  const guard = createGuard({
    activeWorkspace: async () => Number((await json(request, "activeworkspace")).id),
    focusedWindow: async () => {
      const active = await json(request, "activewindow").catch(() => null);
      return active?.address ? toWindow(active) : null;
    },
    windows: () => live.windows(),
  });
  live.guard = guard;
  const pointer = await openVirtualPointer({ runtime: buses.runtime, display, width: layout.width, height: layout.height });
  t.defer(() => pointer.close());
  const keyboard = await openKeyboard(buses, display);
  t.defer(() => keyboard.close());
  let cursor = null;
  const toLayout = (x, y) => ({ x: x + monitor.x, y: y + monitor.y });
  Object.assign(live, {
    keyboard,
    async key(combo) {
      await guard.focus(`press ${combo}`);
      await keyboard.send({ op: "combo", combo });
    },
    async type(text, { delay: pause = 0.02 } = {}) {
      for (const char of text) {
        await guard.focus(`type ${JSON.stringify(char)}`);
        await keyboard.send({ op: "type", text: char, delay: pause });
      }
    },
    async tap(key) {
      await guard.focus(`press ${key}`);
      await keyboard.send({ op: "tap", key });
    },
    async keymap(options = {}) {
      await guard.focus("switch the keymap");
      await keyboard.send({ op: "keymap", layout: options.layout ?? "us", variant: options.variant ?? "", options: options.options ?? "" });
    },
    async pointerMove(x, y) {
      const point = toLayout(x, y);
      await guard.point("move the pointer", point);
      await pointer.move(point.x - layout.x, point.y - layout.y);
      cursor = point;
    },
    async pointerPress(button = "left") {
      if (!cursor) throw new LiveGuardError("live session input stopped: refusing to press before the pointer is on a workspace-9 window");
      await guard.point("press a button", cursor);
      await pointer.button(BUTTONS[button] ?? button, true);
    },
    async pointerRelease(button = "left") {
      if (!cursor) throw new LiveGuardError("live session input stopped: refusing to release before the pointer is on a workspace-9 window");
      await guard.point("release a button", cursor);
      await pointer.button(BUTTONS[button] ?? button, false);
    },
    async click(x, y, button = "left") {
      await live.pointerMove(x, y);
      await delay(80);
      await live.pointerPress(button);
      await delay(60);
      await live.pointerRelease(button);
    },
  });
  await until(async () => Number((await json(request, "activeworkspace")).id) === LIVE_WORKSPACE, { timeout: 5000, label: `workspace ${LIVE_WORKSPACE}` });
  return live;
}

async function openKeyboard(buses, display) {
  const proc = buses.spawn("python3", ["-I", VIRTUAL_KEYBOARD, buses.runtime, display], { name: "live-virtual-keyboard", stdio: ["pipe", "pipe", "pipe"], env: { WAYLAND_DISPLAY: display } });
  const { child } = proc;
  let buffer = "";
  const waiting = [];
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
  await Promise.race([next(), delay(10000).then(() => { throw new Error("the live virtual keyboard didn't start"); })]);
  let chain = Promise.resolve();
  return {
    send(request) {
      const result = chain.then(async () => {
        const reply = next();
        child.stdin.write(`${JSON.stringify(request)}\n`);
        const answer = await Promise.race([reply, delay(30000).then(() => ({ ok: false, error: "no answer in 30 s" }))]);
        if (!answer.ok) throw new Error(`virtual keyboard ${request.op}: ${answer.error}`);
      });
      chain = result.catch(() => {});
      return result;
    },
    async close() {
      try { process.kill(-child.pid, "SIGTERM"); } catch {}
    },
  };
}
