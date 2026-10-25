import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { registerHooks } from "node:module";
import { test } from "node:test";

const sources = new Map([
  [new URL("../src/native.ts", import.meta.url).href, "export const Cef = globalThis.engineEventModules.chromium;"],
  [new URL("../src/engine.ts", import.meta.url).href, "export const engineCall = () => { throw Error('Unexpected engine call'); };"],
]);
const expo = "data:text/javascript," + encodeURIComponent("export const requireOptionalNativeModule = () => globalThis.engineEventModules.webkit;");
const buses = { chromium: null, webkit: null };
globalThis.engineEventModules = Object.fromEntries(Object.keys(buses).map(engine => [engine, {
  addListener(name, listener) {
    const bus = buses[engine];
    bus.on(name, listener);
    return { remove: () => bus.off(name, listener) };
  },
}]));
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "expo-modules-core") return { url: expo, shortCircuit: true };
    if (specifier.startsWith(".") && !/\.[cm]?ts$/.test(specifier)) return next(specifier + ".ts", context);
    return next(specifier, context);
  },
  load(url, context, next) {
    return sources.has(url) ? { format: "module", source: sources.get(url), shortCircuit: true } : next(url, context);
  },
});
const events = await import("../src/module.ts");

for (const shared of [true, false]) {
  for (const [name, ids] of [
    ["onPermission", ["p1", "wk-permission-1"]],
    ["onPermissionDismissed", ["p1", "wk-permission-1"]],
    ["onDownload", ["download-1", "wk-download-1"]],
  ]) {
    test(`${name} delivers each engine once on ${shared ? "shared" : "separate"} event buses`, () => {
      buses.chromium = new EventEmitter();
      buses.webkit = shared ? buses.chromium : new EventEmitter();
      const received = [];
      const sub = events[name](event => received.push(event.id));
      buses.chromium.emit(name, { id: ids[0] });
      buses.webkit.emit(name, { id: ids[1] });
      assert.deepEqual(received, ids);
      sub.remove();
      buses.chromium.emit(name, { id: ids[0] });
      buses.webkit.emit(name, { id: ids[1] });
      assert.deepEqual(received, ids);
      assert.equal(buses.chromium.listenerCount(name), 0);
      assert.equal(buses.webkit.listenerCount(name), 0);
    });
  }
}
