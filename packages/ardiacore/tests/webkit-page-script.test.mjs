import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const pageScript = read("../ios/page_script.js");
const webKitScript = read("../ios/WebKitPageScript.swift");
const between = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} … ${to} not found`);
  return text.slice(start, end).split("\n").map((line) => line.trim()).filter(Boolean).join("\n");
};

test("WebKit's page script decides scroll direction with page_script.js's code and thresholds", () => {
  const scroll = (text) => between(text, "const scrollDirection = () => {", "const direction = scrollDirection();");
  assert.equal(scroll(webKitScript), scroll(pageScript));
});

const slice = (text, from, to) => {
  const start = text.indexOf(from);
  const end = text.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} … ${to} not found`);
  return text.slice(start, end);
};

class FakeMedia {
  constructor(error = null) {
    this.error = error;
  }
}

function drmPage({ access }) {
  const bridge = slice(webKitScript, 'static let mediaBridge = #"""\n', '"""#').replace(/^[^\n]*\n/, "");
  const declarations = slice(webKitScript, "const drmEvents = ", "const detached = ");
  const handlers = slice(webKitScript, "const reportDrm = ", 'document.addEventListener(\n    "ardia:media-element"');
  const posted = [];
  const listeners = {};
  const document = new EventTarget();
  const isolated = { addEventListener: (type, fn) => (listeners[type] ??= []).push(fn) };
  new Function("post", "document", "HTMLMediaElement", `${declarations}${handlers}`)((kind, data) => posted.push({ kind, data }), isolated, FakeMedia);
  document.addEventListener("ardia:drm", (e) => listeners["ardia:drm"].forEach((fn) => fn(e)), true);
  class Navigator {}
  Navigator.prototype.requestMediaKeySystemAccess = function (keySystem) {
    return access(keySystem);
  };
  class Node {
    get isConnected() {
      return true;
    }
  }
  new Function("Navigator", "navigator", "document", "Node", "MouseEvent", "HTMLMediaElement", bridge)(Navigator, new Navigator(), document, Node, class MouseEvent extends Event {}, FakeMedia);
  const fire = (type, target) => listeners[type].forEach((fn) => fn({ type, target }));
  return { navigator: new Navigator(), posted, fire };
}

const denied = (keySystem) => Promise.reject(new DOMException("no", "NotSupportedError"));

test("WebKit's page script reports a refused protected key system once, with its host-free key system and error code", async () => {
  const { navigator, posted } = drmPage({ access: denied });
  await assert.rejects(navigator.requestMediaKeySystemAccess("com.widevine.alpha", []), { name: "NotSupportedError" });
  await navigator.requestMediaKeySystemAccess("com.widevine.alpha", []).catch(() => {});
  assert.deepEqual(posted, [{ kind: "drm", data: { stage: "accessDenied", keySystem: "com.widevine.alpha", code: 9 } }]);
});

test("WebKit's page script reports a granted protected key system and hands the page the same result", async () => {
  const access = { keySystem: "com.widevine.alpha" };
  const { navigator, posted } = drmPage({ access: () => Promise.resolve(access) });
  assert.equal(await navigator.requestMediaKeySystemAccess("com.widevine.alpha", []), access);
  assert.deepEqual(posted, [{ kind: "drm", data: { stage: "access", keySystem: "com.widevine.alpha", code: 0 } }]);
});

test("WebKit's page script leaves other key systems alone", async () => {
  const result = Promise.reject(new DOMException("no", "NotSupportedError"));
  result.catch(() => {});
  const { navigator, posted } = drmPage({ access: () => result });
  assert.equal(navigator.requestMediaKeySystemAccess("org.w3.clearkey", []), result);
  await result.catch(() => {});
  assert.deepEqual(posted, []);
});

test("WebKit's page script reports encrypted, waitingforkey and media error codes, once each, from media elements only", async () => {
  const { navigator, posted, fire } = drmPage({ access: () => Promise.resolve({}) });
  await navigator.requestMediaKeySystemAccess("com.widevine.alpha", []);
  fire("encrypted", new FakeMedia());
  fire("waitingforkey", new FakeMedia());
  fire("waitingforkey", new FakeMedia());
  fire("error", new FakeMedia({ code: 4 }));
  fire("error", new FakeMedia());
  fire("error", {});
  assert.deepEqual(
    posted.map((m) => m.data),
    [
      { stage: "access", keySystem: "com.widevine.alpha", code: 0 },
      { stage: "encrypted", keySystem: "com.widevine.alpha", code: 0 },
      { stage: "waitingforkey", keySystem: "com.widevine.alpha", code: 0 },
      { stage: "error", keySystem: "com.widevine.alpha", code: 4 },
      { stage: "error", keySystem: "com.widevine.alpha", code: 0 },
    ],
  );
});

test("WebKit's page script sends at most 16 distinct drm messages per frame", () => {
  const { posted, fire } = drmPage({ access: () => Promise.resolve({}) });
  for (let code = 1; code <= 40; code++) fire("error", new FakeMedia({ code }));
  assert.equal(posted.length, 16);
});

test("WebKit's page script measures scrolling the way page_script.js does", () => {
  const measure = (text) =>
    between(text, "const target = scrollTarget;", "addEventListener(\"resize\"").replace(/\b(send|post)\("scroll"/, "report(\"scroll\"").replace(/\n?try \{|\n?\} catch \(e\) \{\}\n?\};|\n?\}\);/g, "");
  assert.equal(measure(webKitScript), measure(pageScript));
});
