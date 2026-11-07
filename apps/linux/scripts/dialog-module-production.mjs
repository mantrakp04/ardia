import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import "./host-test-loader.mjs";

const shellUrl = new URL("../src/shims/shell.tsx", import.meta.url).href;
const expoUrl = new URL("../src/shims/expo-modules-core.ts", import.meta.url).href;
const stubs = new Set(["./shellBase", "../session", "../utilityClose", "../sessionClose", "../documentFlush", "../shortcuts", "../../../browser/src/state/browser/store", "../menus", "../shortcutsRuntime"]);
const stub = `
export const emitCommand = () => {};
export const confirm = () => { throw new Error("Unexpected web confirm"); };
export const prompt = () => { throw new Error("Unexpected web prompt"); };
export const flushLinuxSession = async () => {};
export const linuxWindowDeparture = () => undefined;
export const isLinuxUtility = () => false;
export const createWindowCloseBarrier = () => async () => {};
export const quiesceLinuxSession = () => {};
export const resumeLinuxSession = () => {};
export const quiesceLinuxDocuments = () => {};
export const resumeLinuxDocuments = () => {};
export const flushLinuxDocuments = async () => 0;
export const linuxMenuShortcuts = () => [];
export const useBrowser = { getState: () => ({ settings: { shortcuts: {} } }) };
export const menuShown = () => false;
export const showMenu = async () => null;
export const watchMenus = () => () => {};
export const recordShortcut = async () => null;
export const cancelShortcutRecording = async () => {};
`;
registerHooks({
  resolve(specifier, context, next) {
    if (context.parentURL === shellUrl && stubs.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(stub)}`, shortCircuit: true };
    if (specifier === "expo-modules-core") return { url: expoUrl, shortCircuit: true };
    return next(specifier, context);
  },
});
const requests = [], listeners = new Set();
globalThis.window = {
  __ardiaHost: {
    bootstrap: { windowId: "a", profileId: "default" },
    onEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async invoke(method, payload) {
      requests.push({ method, ...payload });
      return method.endsWith("windowIdentity") ? { windowId: "a", rendererGeneration: "1" } : { accepted: true };
    },
  },
};
const shell = await import(shellUrl);
const { requireNativeModule } = await import(expoUrl);
const { confirm, prompt } = await import("../../browser/src/platform/dialogs.ts");
for (const name of ["ArdiaShell", "ArdiaDialogs"]) {
  const native = requireNativeModule(name);
  assert.equal(native.confirm, shell.confirm);
  assert.equal(native.prompt, shell.prompt);
}
for (const [call, kind, result] of [[shell.confirm, "confirm", { confirmed: false, suppressed: false }], [confirm, "confirm", { confirmed: false, suppressed: false }], [prompt, "prompt", " Name "], [shell.prompt, "prompt", null]]) {
  const work = call({ title: "Dialog", windowId: "a" });
  await new Promise(setImmediate);
  const request = requests.at(-1);
  assert.equal(request.method, "ArdiaShell.beginDialog");
  assert.equal(request.args[0].kind, kind);
  const data = { dialogId: request.args[0].dialogId, windowId: "a", rendererGeneration: "1", result };
  for (const listener of listeners) listener("ArdiaShell", "shell", { name: "shell.dialogResolved", data });
  assert.deepEqual(await work, typeof result === "string" ? result.trim() : result);
}
assert.equal(requests.length, 8);
assert.equal(requests.filter((request) => request.method.endsWith("windowIdentity")).length, 4);
console.log("Linux shell exports and package Expo dialogs share the production adapter");
