import assert from "node:assert/strict";
import { test } from "node:test";
import { busConfig, changedRegion, flattenTree, parsePpm, privateEnvironment, regions, changedCells, swayConfig, swipeSteps, toolEnvironment } from "../lib/desktop.mjs";
import { desktopLaunch, sessionEnvironment } from "../lib/desktopSession.mjs";
import { decodeGlobal, decodeMessages, encodeMessage, encodeString, fingerLiftFrame, fingerScrollFrame } from "../lib/waylandPointer.mjs";

const OWNER = { WAYLAND_DISPLAY: "wayland-1", DISPLAY: ":0", HYPRLAND_INSTANCE_SIGNATURE: "sig", SWAYSOCK: "/run/user/1000/sway.sock", DBUS_SESSION_BUS_ADDRESS: "unix:path=/run/user/1000/bus", DBUS_SYSTEM_BUS_ADDRESS: "unix:path=/run/dbus/system_bus_socket", XDG_RUNTIME_DIR: "/run/user/1000", SSH_AUTH_SOCK: "/run/user/1000/ssh", PATH: "/usr/bin" };

test("the private environment drops every handle on the owner's session", () => {
  const env = privateEnvironment(OWNER, { HOME: "/tmp/h" });
  for (const key of ["WAYLAND_DISPLAY", "DISPLAY", "HYPRLAND_INSTANCE_SIGNATURE", "SWAYSOCK", "DBUS_SESSION_BUS_ADDRESS", "DBUS_SYSTEM_BUS_ADDRESS", "SSH_AUTH_SOCK"]) assert.equal(env[key], undefined, key);
  assert.equal(env.HOME, "/tmp/h");
});

test("a tools prefix leads PATH and the library path", () => {
  const env = toolEnvironment({ PATH: "/usr/bin", ARDIA_ACCEPTANCE_TOOLS: "/opt/tools" });
  assert.equal(env.PATH, "/opt/tools/usr/bin:/usr/bin");
  assert.equal(env.LD_LIBRARY_PATH, "/opt/tools/usr/lib");
  assert.equal(toolEnvironment({ PATH: "/usr/bin" }).PATH, "/usr/bin");
});

test("launches in a desktop session get only the private session's display and buses", () => {
  const desktop = { kind: "sway", env: { ...OWNER, WAYLAND_DISPLAY: "wayland-9", XDG_RUNTIME_DIR: "/tmp/r", DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/s", DBUS_SYSTEM_BUS_ADDRESS: "unix:path=/tmp/y", HOME: "/tmp/desk" } };
  const env = sessionEnvironment(desktop);
  assert.equal(env.WAYLAND_DISPLAY, "wayland-9");
  assert.equal(env.DISPLAY, undefined);
  assert.equal(env.DBUS_SYSTEM_BUS_ADDRESS, "unix:path=/tmp/y");
  assert.ok("HYPRLAND_INSTANCE_SIGNATURE" in env && env.HYPRLAND_INSTANCE_SIGNATURE === undefined);
  assert.equal(env.HOME, undefined);
  const x11 = sessionEnvironment({ kind: "x11", env: { DISPLAY: ":42", XDG_RUNTIME_DIR: "/tmp/r", DBUS_SESSION_BUS_ADDRESS: "unix:path=/tmp/s" } });
  assert.equal(x11.DISPLAY, ":42");
  assert.equal(x11.WAYLAND_DISPLAY, undefined);
  const launch = desktopLaunch(desktop);
  assert.equal(launch.ozone, "wayland");
  assert.equal(launch.background, false);
  assert.ok(launch.extraArgs.includes("--use-angle=swiftshader"));
});

test("the private bus allows only its own socket and service directory", () => {
  const config = busConfig({ type: "system", socket: "/tmp/x/system-bus", serviceDir: "/tmp/x/services" });
  assert.match(config, /<type>system<\/type>/);
  assert.match(config, /<listen>unix:path=\/tmp\/x\/system-bus<\/listen>/);
  assert.equal((config.match(/<servicedir>/g) ?? []).length, 1);
  assert.doesNotMatch(config, /standard_session_servicedirs|standard_system_servicedirs|<include/);
});

test("sway gets one headless output per requested output, side by side", () => {
  const config = swayConfig({ outputs: 2 });
  assert.match(config, /output HEADLESS-1 resolution 1920x1080 position 0 0/);
  assert.match(config, /output HEADLESS-2 resolution 1920x1080 position 1920 0/);
  assert.match(config, /xwayland disable/);
});

test("the sway tree flattens into windows with their output and fullscreen state", () => {
  const tree = { type: "root", nodes: [{ type: "output", name: "HEADLESS-2", nodes: [{ type: "workspace", name: "2", nodes: [{ type: "con", id: 7, pid: 10, app_id: "ardia", name: "A - Ardia", focused: true, fullscreen_mode: 1, rect: { x: 1920, y: 0, width: 1920, height: 1080 }, nodes: [] }], floating_nodes: [{ type: "floating_con", id: 9, pid: 10, app_id: "ardia", name: "Dialog", rect: { x: 2000, y: 100, width: 400, height: 200 }, nodes: [] }] }] }] };
  const windows = flattenTree(tree);
  assert.deepEqual(windows.map((w) => [w.id, w.output, w.workspace, w.fullscreen, w.focused, w.floating]), [[7, "HEADLESS-2", "2", true, true, false], [9, "HEADLESS-2", "2", false, false, true]]);
});

function image(width, height, paint = () => [255, 255, 255]) {
  const data = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 3);
  return { width, height, data };
}

test("PPM captures parse and a drawn box is found as the largest changed region", () => {
  const parsed = parsePpm(Buffer.concat([Buffer.from("P6\n# grim\n2 1\n255\n"), Buffer.from([1, 2, 3, 4, 5, 6])]));
  assert.deepEqual([parsed.width, parsed.height, [...parsed.data]], [2, 1, [1, 2, 3, 4, 5, 6]]);
  const before = image(320, 240);
  const after = image(320, 240, (x, y) => (x >= 64 && x < 192 && y >= 32 && y < 128 ? [40, 40, 90] : (x === 300 && y === 200 ? [0, 0, 0] : [255, 255, 255])));
  const region = changedRegion(before, after);
  assert.deepEqual([region.x, region.y, region.width, region.height], [64, 32, 128, 96]);
  assert.equal(changedRegion(before, image(320, 240)), null);
});

test("separate changes stay separate regions unless they are within the gap", () => {
  const before = image(320, 64);
  const after = image(320, 64, (x, y) => ((x < 32 || (x >= 256 && x < 288)) && y < 32 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(regions(changedCells(before, after)).length, 2);
  assert.equal(regions(changedCells(before, after), { gap: 16 }).length, 1);
});

test("Wayland messages encode with their size and opcode and decode globals", () => {
  const message = encodeMessage(6, 2, [5, 0x110, 1]);
  assert.equal(message.readUInt32LE(0), 6);
  assert.equal(message.readUInt32LE(4), (20 << 16) | 2);
  assert.equal(encodeString("wl_seat").length, 4 + 8);
  const body = Buffer.concat([Buffer.from([3, 0, 0, 0]), encodeString("wl_seat"), Buffer.from([7, 0, 0, 0])]);
  const framed = encodeMessage(2, 0, [body]);
  const { messages, rest } = decodeMessages(Buffer.concat([framed, framed.subarray(0, 5)]));
  assert.equal(messages.length, 1);
  assert.equal(rest.length, 5);
  assert.deepEqual(decodeGlobal(messages[0].body), { name: 3, iface: "wl_seat", version: 7 });
});

test("audio, accessibility and inherited Wayland socket variables never reach private processes or launches", () => {
  const owner = { ...OWNER, AT_SPI_BUS_ADDRESS: "unix:path=/run/user/1000/at-spi/bus", PULSE_SERVER: "unix:/run/user/1000/pulse/native", PIPEWIRE_REMOTE: "pipewire-0", WAYLAND_SOCKET: "7" };
  const env = privateEnvironment(owner);
  for (const key of ["AT_SPI_BUS_ADDRESS", "PULSE_SERVER", "PIPEWIRE_REMOTE", "WAYLAND_SOCKET"]) assert.equal(env[key], undefined, key);
  const launch = sessionEnvironment({ kind: "sway", env: owner });
  for (const key of ["AT_SPI_BUS_ADDRESS", "PULSE_SERVER", "PIPEWIRE_REMOTE", "WAYLAND_SOCKET"]) assert.ok(key in launch && launch[key] === undefined, key);
});

test("the live-session guard refuses input off workspace 9 or outside its windows, and stays tripped", async () => {
  const { createGuard, LiveGuardError, layoutBox } = await import("../lib/liveHyprland.mjs");
  const state = { workspace: 9, focused: { title: "A - Ardia", workspace: 9 }, windows: [{ workspace: 9, layout: { x: 100, y: 100, width: 400, height: 300 } }] };
  const guard = createGuard({ activeWorkspace: async () => state.workspace, focusedWindow: async () => state.focused, windows: async () => state.windows });
  assert.equal((await guard.focus("type")).title, "A - Ardia");
  assert.ok(await guard.point("click", { x: 120, y: 120 }));
  await assert.rejects(guard.point("click", { x: 50, y: 50 }), LiveGuardError);
  await assert.rejects(guard.focus("type"), /refusing to click at 50,50/);
  const fresh = createGuard({ activeWorkspace: async () => state.workspace, focusedWindow: async () => state.focused, windows: async () => state.windows });
  state.workspace = 1;
  await assert.rejects(fresh.focus("press ctrl+n"), /workspace 1 is active/);
  state.workspace = 9;
  await assert.rejects(fresh.focus("press ctrl+n"), LiveGuardError);
  const other = createGuard({ activeWorkspace: async () => 9, focusedWindow: async () => ({ title: "owner", workspace: 1 }), windows: async () => [] });
  await assert.rejects(other.focus("type"), /isn't on workspace 9/);
  assert.deepEqual(layoutBox([{ x: 0, y: 0, width: 3840, height: 2160 }, { x: 3840, y: 200, width: 1920, height: 1080 }]), { x: 0, y: 0, width: 5760, height: 2160 });
});

test("a finger swipe is a finger-source horizontal axis frame per step and an axis stop on both axes at lift", () => {
  const frame = decodeMessages(fingerScrollFrame(6, 100, 12.5)).messages;
  assert.deepEqual(frame.map((m) => m.opcode), [5, 3, 4]);
  assert.equal(frame[0].body.readUInt32LE(0), 1);
  assert.equal(frame[1].body.readUInt32LE(4), 1);
  assert.equal(frame[1].body.readInt32LE(8), 3200);
  const lift = decodeMessages(fingerLiftFrame(6, 200)).messages;
  assert.deepEqual(lift.map((m) => m.opcode), [5, 6, 6, 4]);
  assert.deepEqual(lift.slice(1, 3).map((m) => m.body.readUInt32LE(4)), [0, 1]);
  const steps = swipeSteps(300, 24);
  assert.equal(steps.length, 24);
  assert.ok(Math.abs(steps.reduce((a, b) => a + b, 0) - 300) < 1e-9);
  assert.ok(steps[12] > steps[0] && Math.abs(steps[0] - steps[23]) < 1e-9);
});

test("a white surface is measured along a blank row and a blank column inside its edge", async () => {
  const { whiteBox, exactBox } = await import("../lib/desktopUi.mjs");
  const width = 60;
  const height = 40;
  const paint = (boxes) => {
    const data = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const hit = boxes.find(([b]) => x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height);
      data.set(hit ? hit[1] : [247, 238, 241], (y * width + x) * 3);
    }
    return { width, height, data };
  };
  const popup = { x: 20, y: 5, width: 30, height: 20 };
  const image = paint([[{ x: 30, y: 7, width: 15, height: 4 }, [0, 0, 0]], [popup, [255, 255, 255]], [{ x: 18, y: 4, width: 34, height: 23 }, [230, 230, 230]]]);
  assert.deepEqual(whiteBox(image, { x: 35, y: 20 }), popup);
  assert.equal(whiteBox(image, { x: 5, y: 30 }), null);
  const blank = paint([]);
  const drawn = paint([[{ x: 10, y: 10, width: 16, height: 12 }, [20, 20, 20]]]);
  assert.deepEqual(exactBox(blank, drawn, { x: 8, y: 8, width: 32, height: 16 }), { x: 10, y: 10, width: 16, height: 12 });
});

