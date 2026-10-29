import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { desktopTools, startDesktop } from "../lib/desktop.mjs";
import { busCall, startFileManager, startPolkit } from "../lib/desktopServices.mjs";
import { until } from "../lib/util.mjs";

const tools = await desktopTools();
const skip = !tools.dbusDaemon || !tools.dbusmock ? "needs dbus-daemon and python-dbusmock" : false;
const ACTION = "dev.ardia.linux.reauthenticate";
const SUBJECT = ["system-bus-name", { name: ":1.1" }];

async function withBuses(body) {
  const dir = await mkdtemp(join(tmpdir(), "ardia-desktop-services-"));
  const desktop = await startDesktop(dir, { tools, compositor: false });
  try {
    await body(desktop);
  } finally {
    await desktop.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

const check = (desktop, flags, cancellation = "") => busCall(desktop, { system: true, dest: "org.freedesktop.PolicyKit1", path: "/org/freedesktop/PolicyKit1/Authority", iface: "org.freedesktop.PolicyKit1.Authority", method: "CheckAuthorization", args: [SUBJECT, ACTION, {}, flags, cancellation], signature: "(sa{sv})sa{ss}us" });

test("the polkit mock answers the probe with a challenge and each mode as polkit would", { skip, timeout: 60000 }, async () => {
  await withBuses(async (desktop) => {
    const polkit = await startPolkit(desktop, { mode: "deny" });
    assert.deepEqual(await check(desktop, 0), [false, true, {}]);
    assert.deepEqual(await check(desktop, 1), [false, false, {}]);
    await polkit.call("SetMode", ["dismiss"]);
    assert.deepEqual(await check(desktop, 1), [false, false, { "polkit.dismissed": "true" }]);
    await polkit.call("SetMode", ["allow"]);
    assert.deepEqual(await check(desktop, 1), [true, false, {}]);
    await polkit.call("SetMode", ["hang"]);
    const pending = check(desktop, 1, "c1").then(() => "answered", (error) => error.message);
    await new Promise((resolve) => setTimeout(resolve, 500));
    assert.equal(await polkit.call("Hanging", [], { signature: "" }), 1);
    await busCall(desktop, { system: true, dest: "org.freedesktop.PolicyKit1", path: "/org/freedesktop/PolicyKit1/Authority", iface: "org.freedesktop.PolicyKit1.Authority", method: "CancelCheckAuthorization", args: ["c1"], signature: "s" });
    assert.match(await pending, /Cancelled/);
    const calls = await polkit.calls();
    assert.ok(calls.some((c) => c.cancel === "c1"));
    assert.equal(calls.filter((c) => c.action === ACTION).length, 5);
  });
});

test("the polkit mock reports an unregistered action the way polkitd does", { skip, timeout: 60000 }, async () => {
  await withBuses(async (desktop) => {
    await startPolkit(desktop, { registered: [] });
    await assert.rejects(check(desktop, 0), /is not registered/);
  });
});

test("the FileManager1 mock records ShowItems and can fail on request", { skip, timeout: 60000 }, async () => {
  await withBuses(async (desktop) => {
    const manager = await startFileManager(desktop);
    const call = () => busCall(desktop, { dest: "org.freedesktop.FileManager1", path: "/org/freedesktop/FileManager1", iface: "org.freedesktop.FileManager1", method: "ShowItems", args: [["file:///tmp/a.bin"], ""], signature: "ass" });
    await call();
    await manager.call("SetFail", [true], { signature: "b" });
    await assert.rejects(call(), /refused/);
    assert.deepEqual((await manager.calls()).map((c) => c.uris), [["file:///tmp/a.bin"], ["file:///tmp/a.bin"]]);
  });
});

test("the private portal frontend routes FileChooser requests to the scripted backend and records them", { skip: skip || !tools.portal ? "needs dbus-daemon, python-dbusmock and xdg-desktop-portal" : false, timeout: 90000 }, async () => {
  const { startPortal } = await import("../lib/desktopServices.mjs");
  await withBuses(async (desktop) => {
    const portal = await startPortal(desktop);
    assert.ok(portal.version >= 3, `FileChooser version ${portal.version}`);
    const open = (title, options) => busCall(desktop, { dest: "org.freedesktop.portal.Desktop", path: "/org/freedesktop/portal/desktop", iface: "org.freedesktop.portal.FileChooser", method: "OpenFile", args: [title === "folder" ? "x11:1" : "", title, options], signature: "ssa{sv}" });
    await portal.pick("OpenFile", ["/tmp/picked folder"]);
    await open("folder", { directory: true });
    await portal.cancel("OpenFile");
    await open("cancelled", {});
    const calls = await until(async () => {
      const list = await portal.calls();
      return list.length >= 2 ? list : false;
    }, { timeout: 10000, label: "two recorded requests" });
    assert.deepEqual(calls.map((c) => [c.method, c.title, c.options.directory ?? null]), [["OpenFile", "folder", true], ["OpenFile", "cancelled", null]]);
  });
});
