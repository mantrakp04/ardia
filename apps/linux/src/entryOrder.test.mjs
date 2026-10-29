import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeStatements = (path) =>
  readFileSync(new URL(path, import.meta.url), "utf8")
    .split("\n")
    .filter((line) => /^(import|export)\b/.test(line) && !/^import type\b/.test(line) && !/^export (type|const|function|async|class)\b/.test(line));

test("the Linux entry evaluates the shared store before any shim can reach it through a cycle", () => {
  assert.equal(runtimeStatements("./main.tsx")[0], 'import "../../browser/src/state/browser/store";');
});

test("the shell shim evaluates the real shell package before the app modules that bind its native calls", () => {
  assert.equal(runtimeStatements("./shims/shellBase.tsx")[0], 'export * from "@ardia-real/shell";');
});

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
