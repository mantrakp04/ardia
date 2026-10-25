import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("    const NavigatorType = window.Navigator;\n");
const end = script.indexOf("  } catch (e) {}\n", start);
assert.ok(start > 0 && end > start, "page_script.js has the DRM block");
const source = script.slice(start, end);

function page(supported) {
  const sent = [];
  class Navigator {}
  Object.defineProperty(Navigator.prototype, "requestMediaKeySystemAccess", {
    value(keySystem) {
      return supported.includes(keySystem) ? Promise.resolve({ keySystem }) : Promise.reject(new Error("NotSupportedError"));
    },
    writable: true,
    enumerable: true,
    configurable: true,
  });
  const navigator = new Navigator();
  const run = new Function("window", "apply", "send", source);
  run({ Navigator }, Reflect.apply, (kind, data) => sent.push({ kind, data }));
  return { navigator, Navigator, sent };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a failed Widevine request is reported once and still fails for the page", async () => {
  const { navigator, sent } = page(["org.w3.clearkey"]);
  await assert.rejects(navigator.requestMediaKeySystemAccess("com.widevine.alpha", []));
  await assert.rejects(navigator.requestMediaKeySystemAccess("com.microsoft.playready", []));
  await settle();
  assert.deepEqual(sent, [{ kind: "drm", data: { keySystem: "com.widevine.alpha" } }]);
});

test("Clear Key and supported systems aren't reported, and the method keeps its shape", async () => {
  const { navigator, Navigator, sent } = page(["org.w3.clearkey", "com.widevine.alpha"]);
  assert.deepEqual(await navigator.requestMediaKeySystemAccess("com.widevine.alpha", []), { keySystem: "com.widevine.alpha" });
  await assert.rejects(navigator.requestMediaKeySystemAccess("org.w3.unknown", []));
  await settle();
  assert.deepEqual(sent, []);
  const descriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, "requestMediaKeySystemAccess");
  assert.equal(descriptor.enumerable, true);
  assert.equal(descriptor.value.name, "requestMediaKeySystemAccess");
  assert.equal(descriptor.value.length, 2);
  assert.equal(Object.hasOwn(navigator, "requestMediaKeySystemAccess"), false);
});
