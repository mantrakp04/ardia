import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const source = script.slice(script.indexOf("  const parse = (css) =>"), script.indexOf("  if (window.visualViewport)"));

function page({ hostname = "mail.google.com", background = "rgba(0,0,0,0)", bodyBackground = "rgb(17,17,17)", meta = "#fff" } = {}) {
  const reports = [], frames = [], observers = [];
  const element = (nodeName, parentElement, background = "rgba(0,0,0,0)") => ({
    nodeName, nodeType: 1, parentElement, background, attrs: {},
    getAttribute(name) { return this.attrs[name] ?? null; },
  });
  const html = element("HTML", null, "rgb(255,255,255)");
  const head = element("HEAD", html);
  const body = element("BODY", html, bodyBackground);
  const app = element("DIV", body);
  const header = element("HEADER", app, background);
  class MutationObserver {
    targets = new Map();
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.targets.set(target, options); }
    disconnect() { this.targets.clear(); }
  }
  const themeMeta = { getAttribute: (name) => name === "content" ? meta : null };
  html.appendChild = () => {};
  const context = {
    location: { hostname },
    document: { documentElement: html, body, head, querySelectorAll: () => meta ? [themeMeta] : [], createElement: () => ({ style: {}, remove() {} }), elementFromPoint: () => header, addEventListener() {} },
    getComputedStyle: (el) => ({ backgroundColor: el.background, position: "static", colorScheme: "light", color: el.style?.color === "#fff" ? "rgb(255,255,255)" : el.style?.color }),
    MutationObserver, innerWidth: 1000, scrollY: 0,
    setTimeout() {}, clearTimeout() {}, addEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    apply: Reflect.apply, raf: (fn) => frames.push(fn),
    guard: (fn) => fn, onReady: (fn) => fn(),
    send: (_kind, data) => reports.push(JSON.parse(JSON.stringify(data))),
  };
  context.window = context;
  runInNewContext(source, context);
  const mutate = (target, attributeName, value) => {
    const oldValue = target.getAttribute(attributeName);
    target.attrs[attributeName] = value;
    for (const observer of observers) {
      const options = observer.targets.get(target);
      if (options?.attributes && options.attributeFilter.includes(attributeName))
        observer.callback([{ type: "attributes", target, attributeName, oldValue }]);
    }
    while (frames.length) frames.shift()();
  };
  return { reports, body, mutate };
}

test("Gmail's fixed white metadata does not override its saved dark theme", () => {
  const p = page();
  assert.deepEqual(p.reports.at(-1), { color: "#111111", source: "background" });
});

test("Gmail's light theme stays light", () => {
  const p = page({ bodyBackground: "rgb(255,255,255)" });
  assert.equal(p.reports.at(-1).color, "#FFFFFF");
});

test("Gmail's rendered header takes priority over its fixed metadata", () => {
  const p = page({ background: "rgb(20,60,40)" });
  assert.deepEqual(p.reports.at(-1), { color: "#143C28", source: "header" });
});

test("Gmail theme changes are sampled even though its metadata stays white", () => {
  const p = page();
  p.body.background = "rgb(255,255,255)";
  p.mutate(p.body, "style", "background:white");
  assert.equal(p.reports.at(-1).color, "#FFFFFF");
  p.body.background = "rgb(17,17,17)";
  p.mutate(p.body, "style", "background:#111");
  assert.equal(p.reports.at(-1).color, "#111111");
});

test("other sites keep their explicit theme-color priority", () => {
  const p = page({ hostname: "example.com" });
  assert.deepEqual(p.reports.at(-1), { color: "#FFFFFF", source: "meta" });
});

test("the exception applies only to Gmail's exact hostname", () => {
  const p = page({ hostname: "mail.google.com.example.com" });
  assert.deepEqual(p.reports.at(-1), { color: "#FFFFFF", source: "meta" });
});
