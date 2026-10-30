import assert from "node:assert/strict";
import test from "node:test";

test("a Linux-only command reaches the Linux handlers and never the shared dispatcher, which knows only its catalog", async () => {
  const { emitNativeEvent, onLinuxCommand, requireNativeModule, setSharedCommands } = await import("./shims/expo-modules-core.ts");
  const shared = [];
  const linux = [];
  const menus = requireNativeModule("ArdiaMenus").addListener("onCommand", (event) => shared.push(event.command));
  const own = onLinuxCommand((event) => linux.push(event.command));
  setSharedCommands((command) => command === "newTab");
  try {
    emitNativeEvent("ArdiaShell", "onCommand", { command: "quit", arg: null, windowId: "main" });
    emitNativeEvent("ArdiaShell", "onCommand", { command: "newTab", arg: null, windowId: "main" });
    assert.deepEqual(shared, ["newTab"]);
    assert.deepEqual(linux, ["quit", "newTab"]);
  } finally {
    setSharedCommands(() => true);
    menus.remove();
    own.remove();
  }
});
