import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import { after, before, describe, it } from "node:test";
import { launchArdia, launchArguments, launchEnvironment } from "../lib/ardia.mjs";
import { startMockCdp } from "./mock-cdp.mjs";

function fakeShell({ windowId, startup = false, utility = null }) {
  const commands = [];
  const state = {
    windows: { [windowId]: { id: windowId, profileId: "default", tabIds: ["t1"], activeTabIds: { default: "t1" } } },
    tabs: { t1: { id: "t1", windowId, url: "" } },
    find: {},
    newTab(owner, { url }) {
      const id = `t${Object.keys(state.tabs).length + 1}`;
      state.tabs[id] = { id, windowId: owner, url: "" };
      state.windows[owner].tabIds.push(id);
      setTimeout(() => { state.tabs[id].url = url; }, 30);
      return id;
    },
    navigate(id, url) { setTimeout(() => { state.tabs[id].url = url; }, 30); },
  };
  const host = {
    bootstrap: { windowId, profileId: "default", startup, utility },
    async invoke(method, args) {
      if (method === "ArdiaShell.windowIds") return ["main", "second"];
      if (method === "tab.create") throw Object.assign(new Error("Profile not hosted"), { code: "ERR_PROFILE_WINDOW" });
      return { method, args };
    },
    async call(name, profile, args) {
      return JSON.stringify({ name, profile, args: JSON.parse(args) });
    },
  };
  const context = vm.createContext({
    ardiaLinux: { store: { getState: () => state }, emitCommand: (event) => commands.push(event) },
    __ardiaHost: host,
    document: { querySelector: (selector) => (selector === "[data-ardia-linux-window]" ? {} : null), body: { innerText: `window ${windowId}` } },
    globalThis: undefined,
    JSON,
    Promise,
    setTimeout,
  });
  context.globalThis = context;
  return { context, commands, state };
}

async function evaluateIn(context, expression) {
  try {
    const value = await vm.runInContext(expression, context);
    return { result: { type: typeof value, value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)) } };
  } catch (error) {
    return { exceptionDetails: { text: "Uncaught", exception: { description: String(error?.stack ?? error) } } };
  }
}

describe("Ardia launch plumbing and shell driver against a mock host", () => {
  let mock;
  let scratch;
  const shells = {
    main: fakeShell({ windowId: "main", startup: true }),
    second: fakeShell({ windowId: "second" }),
    settings: fakeShell({ windowId: "settings", utility: { pane: "general" } }),
  };
  let sleeper;

  before(async () => {
    scratch = await mkdtemp(join(tmpdir(), "ardia-acceptance-mock-"));
    mock = await startMockCdp({
      targets: [
        { id: "shell-second", type: "page", url: "chrome://ardia/index.html" },
        { id: "shell-main", type: "page", url: "chrome://ardia/index.html" },
        { id: "shell-settings", type: "page", url: "chrome://ardia/index.html" },
        { id: "page-1", type: "page", url: "http://plain.ardia.test/page/1" },
      ],
      handlers: {
        "Runtime.evaluate": (params, { targetId }) => {
          const shell = shells[targetId.replace("shell-", "")];
          return shell ? evaluateIn(shell.context, params.expression) : { result: { type: "undefined" } };
        },
        "Browser.close": () => { sleeper?.kill("SIGTERM"); return {}; },
      },
    });
  });
  after(async () => {
    await mock.close();
    await rm(scratch, { recursive: true, force: true });
  });

  const fakeSpawn = (writePort = true) => (executable, args, options) => {
    sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { ...options, env: process.env });
    if (writePort) void writeFile(join(scratch, "DevToolsActivePort"), `${mock.port}\n/devtools/browser/mock\n`);
    else setTimeout(() => sleeper.kill("SIGTERM"), 100);
    return sleeper;
  };

  it("builds headless, throwaway launch arguments and environment", () => {
    const args = launchArguments({ scratch: "/s", uiDir: "/ui", extraArgs: ["--x"] });
    for (const flag of ["--user-data-dir=/s", "--ozone-platform=headless", "--remote-debugging-port=0", "--ardia-ui-dir=/ui", "--x"]) assert.ok(args.includes(flag), flag);
    assert.ok(args.includes("--disable-extensions"));
    assert.ok(!launchArguments({ scratch: "/s", extensions: true }).includes("--disable-extensions"));
    const env = launchEnvironment({ scratch: "/s", base: { PATH: "/bin", ARDIA_SWITCHES: "a=1", XDG_ACTIVATION_TOKEN: "t", WAYLAND_DISPLAY: "wayland-1" } });
    assert.equal(env.ARDIA_BACKGROUND, "1");
    assert.equal(env.ARDIA_DATA_DIR, "/s");
    assert.equal(env.HOME, "/s/home");
    assert.equal(env.WAYLAND_DISPLAY, "");
    assert.ok(!("ARDIA_SWITCHES" in env) && !("XDG_ACTIVATION_TOKEN" in env));
    assert.match(env.DBUS_SESSION_BUS_ADDRESS, /^unix:path=\/s\//);
    const foreground = launchEnvironment({ scratch: "/s", background: false, base: { ARDIA_BACKGROUND: "1" } });
    assert.ok(!("ARDIA_BACKGROUND" in foreground));
  });

  it("launches, finds shells by bootstrap and prefers the startup window", async () => {
    const app = await launchArdia({ executable: "/bin/true", scratch, spawnImpl: fakeSpawn(), startTimeout: 5000 });
    try {
      const found = await app.shells();
      assert.deepEqual(found.map((s) => s.windowId).sort(), ["main", "second", "settings"]);
      const main = await app.mainShell({ timeout: 3000 });
      assert.equal(main.windowId, "main");
      const second = await app.shell("second", { timeout: 3000 });
      assert.equal(second.windowId, "second");
      assert.deepEqual(await main.windowIds(), ["main", "second"]);
      const id = await main.newTab("http://plain.ardia.test/page/2");
      const tab = await main.waitTabUrl(id, (url) => url === "http://plain.ardia.test/page/2", { timeout: 2000 });
      assert.equal(tab.windowId, "main");
      assert.equal(await main.activeTabId(), "t1");
      await main.command("findNext");
      assert.deepEqual(JSON.parse(JSON.stringify(shells.main.commands)), [{ command: "findNext", windowId: "main" }]);
      const refused = await main.invoke("tab.create", { profile: "default" });
      assert.deepEqual(refused, { ok: false, code: "ERR_PROFILE_WINDOW", message: "Profile not hosted" });
      const reply = await main.call("downloads.pause", { id: "x" });
      assert.deepEqual(reply, { ok: true, value: { name: "downloads.pause", profile: "", args: { id: "x" } } });
      assert.equal(await main.text(), "window main");
      const target = await app.pageTarget((t) => t.url.endsWith("/page/1"), { timeout: 1000 });
      assert.equal(target.id, "page-1");
    } finally {
      const pid = sleeper.pid;
      assert.equal(await app.close(), true);
      assert.throws(() => process.kill(-pid, 0));
      assert.ok(mock.received.some((m) => m.method === "Browser.close"));
    }
  });

  it("turns core dumps off through a shell wrapper only when asked", async () => {
    const seen = [];
    const recording = (executable, args, options) => {
      seen.push([executable, args]);
      return fakeSpawn(false)(executable, args, options);
    };
    await assert.rejects(launchArdia({ executable: "/opt/ardia/bin/ardia", scratch, spawnImpl: recording, coreDumps: false, startTimeout: 10000 }), /exited/);
    await assert.rejects(launchArdia({ executable: "/opt/ardia/bin/ardia", scratch, spawnImpl: recording, startTimeout: 10000 }), /exited/);
    assert.equal(seen[0][0], "/bin/sh");
    assert.deepEqual(seen[0][1].slice(0, 3), ["-c", 'ulimit -c 0; exec "$0" "$@"', "/opt/ardia/bin/ardia"]);
    assert.ok(seen[0][1].includes(`--user-data-dir=${scratch}`));
    assert.equal(seen[1][0], "/opt/ardia/bin/ardia");
  });

  it("fails fast when the browser exits before DevTools starts", async () => {
    await assert.rejects(launchArdia({ executable: "/bin/true", scratch, spawnImpl: fakeSpawn(false), startTimeout: 10000 }), /exited/);
  });
});
