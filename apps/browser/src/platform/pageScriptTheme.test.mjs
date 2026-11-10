import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("  const parse = (css) =>");
const end = script.indexOf("  if (window.visualViewport)");
assert.ok(start > 0 && end > start, "page_script.js has the theme block");
const themeBlock = script.slice(start, end);

const CLEAR = "rgba(0, 0, 0, 0)";

const CHROMIUM_COMPUTED = { "lch(94.44% 0.5 282 / 1)": "lch(94.44 0.5 282)" };

const rgbOf = (value) => {
  if (!value || !value.startsWith("#")) return CHROMIUM_COMPUTED[value] ?? value ?? "";
  const h = value.length === 4 ? value.replace(/[0-9a-f]/gi, (d) => d + d) : value;
  return `rgb(${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)})`;
};

function page({ meta = null, body = CLEAR, html = CLEAR, top = CLEAR, topPosition = "static" } = {}) {
  const reports = [];
  const frames = [];
  let timers = [];
  const observers = [];
  const listeners = {};
  const element = (nodeName, parentElement, background, position = "static") => ({
    nodeName,
    parentElement,
    background,
    position,
    attrs: {},
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
  });
  const htmlEl = element("HTML", null, html);
  const bodyEl = element("BODY", htmlEl, body);
  const topEl = element("DIV", bodyEl, top, topPosition);
  htmlEl.appendChild = () => {};
  const themeMeta = { getAttribute: (name) => (name === "content" ? meta : null) };
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.targets = new Map();
      observers.push(this);
    }
    observe(target, options) {
      this.targets.set(target, options);
    }
  }
  const media = { matches: false, addEventListener() {}, removeEventListener() {} };
  const context = {
    document: {
      documentElement: htmlEl,
      body: bodyEl,
      head: element("HEAD", htmlEl, CLEAR),
      querySelectorAll: () => (meta ? [themeMeta] : []),
      createElement: () => ({ style: {}, remove() {} }),
      elementFromPoint: () => topEl,
      addEventListener() {},
    },
    getComputedStyle: (el) => ({ backgroundColor: el.background, position: el.position, colorScheme: "normal", color: rgbOf(el.style?.color) }),
    MutationObserver,
    innerWidth: 1000,
    scrollY: 0,
    performance,
    setTimeout: (fn) => timers.push(fn),
    clearTimeout() {},
    addEventListener: (type, fn) => (listeners[type] = fn),
    matchMedia: () => media,
    apply: Reflect.apply,
    listen() {},
    unlisten() {},
    raf: (fn) => frames.push(fn),
    guard: (fn) => fn,
    onReady: (fn) => fn(),
    send: (_kind, data) => reports.push(JSON.parse(JSON.stringify(data))),
  };
  context.window = context;
  runInNewContext(themeBlock, context);
  const settle = () => {
    for (let i = 0; i < 10 && (frames.length || timers.length); i++) {
      while (frames.length) frames.shift()();
      const due = timers;
      timers = [];
      for (const fn of due) fn();
    }
  };
  const restyle = (el, background) => {
    const oldValue = el.getAttribute("style");
    el.background = background;
    el.attrs.style = background;
    for (const observer of observers)
      if (observer.targets.get(el)?.attributeFilter?.includes("style"))
        observer.callback([{ type: "attributes", target: el, attributeName: "style", oldValue }]);
    settle();
  };
  const scrollTo = (y) => {
    context.scrollY = y;
    listeners.scroll();
    settle();
  };
  return { reports, last: () => reports.at(-1), body: bodyEl, top: topEl, restyle, scrollTo, settle };
}

test("a stale light theme-color over a dark page and a dark fixed header follows the header (#544)", () => {
  const p = page({ meta: "#f6f8fc", body: "rgb(21, 21, 21)", top: "rgb(0, 0, 0)", topPosition: "fixed" });
  assert.deepEqual(p.last(), { color: "#000000", source: "header" });
});

test("a stale white theme-color over a dark page with no header follows the page", () => {
  assert.deepEqual(page({ meta: "#fff", body: "rgb(17, 17, 17)" }).last(), { color: "#111111", source: "background" });
});

test("a dark html background counts when the body paints nothing", () => {
  assert.deepEqual(page({ meta: "#eaecf0", html: "rgb(16, 20, 24)" }).last(), { color: "#101418", source: "background" });
});

test("a light theme-color over a light page is kept", () => {
  assert.deepEqual(page({ meta: "#f3eee4", body: "rgb(243, 238, 228)" }).last(), { color: "#F3EEE4", source: "meta" });
});

test("a dark theme-color over a light page is kept, even under a light header", () => {
  assert.deepEqual(page({ meta: "#1e2327", body: "rgb(255, 255, 255)", top: "rgb(246, 248, 250)", topPosition: "sticky" }).last(), {
    color: "#1E2327",
    source: "meta",
  });
});

test("a light page with a dark hero at the top keeps its light theme-color", () => {
  assert.deepEqual(page({ meta: "#ffffff", body: "rgb(255, 255, 255)", top: "rgb(10, 10, 10)" }).last(), { color: "#FFFFFF", source: "meta" });
});

test("a light theme-color that matches a light fixed header over a dark page is kept", () => {
  assert.deepEqual(page({ meta: "#ffffff", body: "rgb(17, 17, 17)", top: "rgb(255, 255, 255)", topPosition: "fixed" }).last(), {
    color: "#FFFFFF",
    source: "meta",
  });
});

test("a mid-tone brand theme-color over a dark page is kept", () => {
  assert.deepEqual(page({ meta: "#1a73e8", body: "rgb(0, 0, 0)" }).last(), { color: "#1A73E8", source: "meta" });
});

test("a light theme-color over a page painted in color(srgb …) is kept, as on Perplexity (#884)", () => {
  const nearWhite = "color(srgb 0.984314 0.984314 0.984314)";
  assert.deepEqual(page({ meta: "#FCFCF9", body: nearWhite, top: nearWhite }).last(), { color: "#FCFCF9", source: "meta" });
});

test("an lch() theme-color is read as the light gray it is, as on Linear (#884)", () => {
  assert.deepEqual(page({ meta: "lch(94.44% 0.5 282 / 1)", html: "lch(94.44 0.5 282)" }).last(), { color: "#EFEFF0", source: "meta" });
});

test("theme-colors in newer CSS color formats land within a step of what Chromium paints", () => {
  const paintedByChromium = {
    "oklch(0.3 0.1 260)": [11, 44, 95],
    "lab(20 10 -30)": [40, 45, 93],
    "lch(50 60 30)": [202, 73, 72],
    "oklab(0.5 0.05 -0.1)": [106, 84, 155],
    "color(display-p3 0.2 0.4 0.8)": [26, 104, 211],
    "color(display-p3 1 0 0)": [255, 1, 0],
    "color(display-p3 -1 0.5 0.5)": [0, 141, 134],
    "color(display-p3 0.9 -0.2 0.4)": [252, 0, 102],
    "lch(50 0 none)": [120, 119, 119],
    "oklch(0.6 none 120)": [128, 128, 128],
    "color(srgb-linear 0.5 0.2 0.1)": [188, 124, 89],
    "lab(98 0 0)": [249, 249, 249],
  };
  for (const [meta, painted] of Object.entries(paintedByChromium)) {
    const { color, source } = page({ meta }).last();
    assert.equal(source, "meta", meta);
    assert.match(color, /^#[0-9A-F]{6}$/, meta);
    const read = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
    assert.ok(
      read.every((n, i) => Math.abs(n - painted[i]) <= 1),
      `${meta} read as ${color}, Chromium paints rgb(${painted})`,
    );
  }
});

test("a theme-color in a colour space the script can't convert is skipped for the page", () => {
  assert.deepEqual(page({ meta: "color(rec2020 0.5 0.5 0.5)", body: "rgb(31, 31, 31)" }).last(), { color: "#1F1F1F", source: "background" });
});

test("a translucent color(srgb …) header is blended over the page", () => {
  const p = page({ body: "rgb(255, 255, 255)", top: "color(srgb 0 0 0 / 0.5)", topPosition: "fixed" });
  assert.deepEqual(p.last(), { color: "#808080", source: "header" });
});

test("a page that hasn't painted yet keeps its light theme-color", () => {
  assert.deepEqual(page({ meta: "#f6f8fc" }).last(), { color: "#F6F8FC", source: "meta" });
});

test("pages without a theme-color are sampled as before", () => {
  assert.deepEqual(page({ body: "rgb(255, 255, 255)", top: "rgb(36, 41, 47)", topPosition: "fixed" }).last(), { color: "#24292F", source: "header" });
  assert.deepEqual(page({ body: "rgb(31, 31, 31)" }).last(), { color: "#1F1F1F", source: "background" });
});

test("switching the page between light and dark switches between the theme-color and the page", () => {
  const p = page({ meta: "#f6f8fc", body: "rgb(255, 255, 255)" });
  assert.equal(p.last().source, "meta");
  p.restyle(p.body, "rgb(17, 17, 17)");
  assert.deepEqual(p.last(), { color: "#111111", source: "background" });
  p.restyle(p.body, "rgb(255, 255, 255)");
  assert.deepEqual(p.last(), { color: "#F6F8FC", source: "meta" });
});

test("scrolling a page whose theme-color was overruled keeps sampling it", () => {
  const p = page({ meta: "#ffffff", body: "rgb(17, 17, 17)" });
  assert.equal(p.last().source, "background");
  p.top.background = "rgb(32, 33, 36)";
  p.top.position = "sticky";
  p.scrollTo(400);
  assert.deepEqual(p.last(), { color: "#202124", source: "header" });
});

test("a light header that agrees with the theme-color only while scrolled hands back to the dark page at the top", () => {
  const p = page({ meta: "#ffffff", body: "rgb(17, 17, 17)" });
  p.top.background = "rgb(255, 255, 255)";
  p.top.position = "sticky";
  p.scrollTo(400);
  assert.deepEqual(p.last(), { color: "#FFFFFF", source: "meta" });
  p.top.background = CLEAR;
  p.top.position = "static";
  p.scrollTo(0);
  assert.deepEqual(p.last(), { color: "#111111", source: "background" });
});

test("scrolling a page with a trusted theme-color samples nothing", () => {
  const p = page({ meta: "#1e2327", body: "rgb(255, 255, 255)" });
  const sent = p.reports.length;
  p.top.background = "rgb(255, 255, 255)";
  p.top.position = "sticky";
  p.scrollTo(400);
  assert.equal(p.reports.length, sent);
  assert.deepEqual(p.last(), { color: "#1E2327", source: "meta" });
});
