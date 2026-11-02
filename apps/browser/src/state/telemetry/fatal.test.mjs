import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";

globalThis.__DEV__ = false;
const stub = await import("../../test-native/index.ts");
Object.assign(stub.appInfo, { appVersion: "0.3.0", osVersion: "27.0.1", arch: "arm64", isolatedInstance: false });
stub.docs.set("telemetry.json", JSON.stringify({ version: 1, sharing: true, decidedAt: 1, askDoneAt: 1, installId: "install", crashCursor: 0, lastVersion: "0.3.0", sessionOpen: false }));
globalThis.fetch = async () => ({ status: 200 });

const require = createRequire(import.meta.url);
const babel = require("@babel/core");
const reactNative = require.resolve("react-native-macos/package.json").replace(/package\.json$/, "");
const nativeReports = [];
const fakes = {
  "./NativeExceptionsManager": { default: { reportException: (data) => nativeReports.push(data) } },
  "./Devtools/parseErrorStack": { default: () => [] },
  "../Utilities/stringifySafe": { default: (value) => String(value) },
  react: {},
};
const loaded = {};
function load(file) {
  const { code } = babel.transformSync(readFileSync(reactNative + file, "utf8"), {
    babelrc: false,
    configFile: false,
    plugins: ["babel-plugin-syntax-hermes-parser", "@babel/plugin-transform-flow-strip-types", "@babel/plugin-transform-modules-commonjs"].map((p) => require.resolve(p)),
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)((name) => fakes[name] ?? loaded[name] ?? {}, module, module.exports);
  return module.exports;
}
loaded["../../../../Libraries/Core/ExceptionsManager"] = load("Libraries/Core/ExceptionsManager.js");
const { onUncaughtError } = load("src/private/renderer/errorhandling/ErrorHandlers.js");
const ExceptionsManager = loaded["../../../../Libraries/Core/ExceptionsManager"].default;

const { holdFatalReports, installErrorReporting } = await import("./errors.ts");
console.error = () => {};
installErrorReporting();
assert.equal(holdFatalReports(ExceptionsManager), true);

const shell = stub.shellNativeModules.ArdiaDocuments;
const realSave = shell.saveDocument;
let saves = 0;
shell.saveDocument = (...args) => (saves++, realSave(...args));
const queuedExceptions = () => JSON.parse(stub.docs.get("telemetry-queue.json") ?? "{}").events?.filter((e) => e.event === "$exception") ?? [];
const settle = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

test("a render error React hands to onUncaughtError reaches native only after its report is on disk", async () => {
  stub.heldSaves.on = true;
  onUncaughtError(new TypeError("Attempting to run JS driven animation on a native node"), { componentStack: "\n    in GroupBlock" });
  await settle();
  assert.equal(saves, 1);
  assert.equal(nativeReports.length, 0);
  stub.heldSaves.on = false;
  for (const land of stub.heldSaves.queue.splice(0)) land();
  await settle(0);
  assert.equal(nativeReports.length, 1);
  assert.equal(nativeReports[0].isFatal, true);
  const reported = queuedExceptions().filter((e) => e.properties.$exception_values?.[0] === "Attempting to run JS driven animation on a native node");
  assert.equal(reported.length, 1);
  assert.equal(reported[0].properties.$exception_level, "fatal");
  assert.equal(reported[0].properties.source, "react");
});

test("a non-fatal handled exception goes straight through", async () => {
  const before = nativeReports.length;
  ExceptionsManager.handleException(new Error("soft"), false);
  assert.equal(nativeReports.length, before + 1);
  assert.equal(nativeReports.at(-1).isFatal, false);
});
