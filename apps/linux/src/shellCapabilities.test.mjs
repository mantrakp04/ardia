import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolveHostModule } from "./hostModules.ts";
import { linuxShellMethod } from "./shellMethods.ts";

const host = readFileSync(new URL("../../../engine/ardiacore-linux/src/ardia/linux/ac_linux_host.cc", import.meta.url), "utf8");
const bootstrap = host.slice(host.indexOf("base::DictValue ShellHostView::Bootstrap() const {"), host.indexOf("void ShellHostView::LayoutOverlay()"));
const advertised = new Set([...bootstrap.matchAll(/\.Append\("([A-Za-z]+\.[A-Za-z]+)"\)/g)].map((match) => match[1]));
const implemented = (method) => host.includes(`method == "ArdiaShell.${method}"`);

const fakeHost = (capabilities, invoke = async () => null) => ({
  bootstrap: { windowId: "main", profileId: "default", capabilities },
  invoke,
  call: async () => "null",
  onEvent: () => () => {},
});

test("the native shell methods the shared UI waits on are advertised, and a Linux fallback only stands in for a native method the host doesn't advertise", () => {
  for (const method of ["restoreFullScreen", "typeaheadReady", "commandsReady", "pickFiles"]) assert.ok(advertised.has(`ArdiaShell.${method}`), method);
  const shadowed = [...host.matchAll(/method == "ArdiaShell\.(\w+)"/g)].map((match) => match[1]).filter((method) => linuxShellMethod(method) && !advertised.has(`ArdiaShell.${method}`));
  assert.deepEqual(shadowed, []);
});

test("Open File… reaches the native chooser, and an engine without it rejects explicitly instead of hanging", async () => {
  const calls = [];
  const current = fakeHost([...advertised], async (method, args) => { calls.push([method, args]); return ["file:///home/user/a.pdf"]; });
  assert.deepEqual(await resolveHostModule(current, "ArdiaShell", "pickFiles")(), ["file:///home/user/a.pdf"]);
  assert.deepEqual(calls, [["ArdiaShell.pickFiles", { args: [] }]]);
  const older = fakeHost([...advertised].filter((capability) => capability !== "ArdiaShell.pickFiles"));
  await assert.rejects(resolveHostModule(older, "ArdiaShell", "pickFiles")(), { code: "ERR_UNAVAILABLE" });
});

test("native shell methods reach the host whether or not they are advertised", async () => {
  for (const capabilities of [[...advertised], []]) {
    const calls = [];
    const resolved = fakeHost(capabilities, async (method, args) => { calls.push([method, args]); return null; });
    for (const method of ["restoreFullScreen", "windowFrame"]) {
      assert.ok(implemented(method), method);
      await resolveHostModule(resolved, "ArdiaShell", method)("main");
    }
    assert.deepEqual(calls.map(([method]) => method), ["ArdiaShell.restoreFullScreen", "ArdiaShell.windowFrame"]);
  }
});
