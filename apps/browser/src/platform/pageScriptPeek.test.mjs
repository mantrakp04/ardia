import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { matchesUrl, parseMatchPattern } from "../lib/matchPattern.ts";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("  let peekKey = null;\n");
const end = script.indexOf("  } catch (e) {}\n", start);
assert.ok(start > 0 && end > start, "page_script.js has the peek block");
const source = `${script.slice(start, end)}  } catch (e) {\n    throw e;\n  }\n`;

const XHTML = "http://www.w3.org/1999/xhtml";
const BASE = "https://page.example/dir/";

function environment({ top = true, page = "https://page.example", selection = null } = {}) {
  const sent = [];
  const opened = [];
  const clicked = [];
  const listeners = {};
  const targets = new Map();
  const bubblingOn = (node) => {
    if (!targets.has(node)) targets.set(node, {});
    return targets.get(node);
  };
  const timers = [];
  let clock = 1000;
  class Node {
    get nodeType() {
      return 1;
    }
    get baseURI() {
      return BASE;
    }
  }
  class Element extends Node {
    constructor(name, attrs = {}, ns = XHTML) {
      super();
      this.name = name;
      this.attrs = { ...attrs };
      this.ns = ns;
      this.editable = false;
    }
    get localName() {
      return this.name;
    }
    get namespaceURI() {
      return this.ns;
    }
    hasAttribute(n) {
      return n in this.attrs;
    }
    getAttribute(n) {
      return n in this.attrs ? this.attrs[n] : null;
    }
    getAttributeNS(_ns, n) {
      return this.getAttribute(`xlink:${n}`);
    }
    setAttribute(n, v) {
      this.attrs[n] = String(v);
    }
  }
  class HTMLElement extends Element {
    get isContentEditable() {
      return this.editable;
    }
    click() {
      clicked.push(this);
    }
  }
  class HTMLAnchorElement extends HTMLElement {
    get href() {
      return new URL(this.attrs.href, BASE).href;
    }
    get target() {
      return this.attrs.target ?? "";
    }
  }
  class HTMLAreaElement extends HTMLElement {
    get href() {
      return new URL(this.attrs.href, BASE).href;
    }
    get target() {
      return this.attrs.target ?? "";
    }
  }
  class Event {
    get timeStamp() {
      return this.init?.stamp ?? 0;
    }
    constructor(type, init = {}) {
      this.type = type;
      this.isTrusted = init.trusted ?? true;
      this.path = init.path ?? [];
      this.prevented = false;
      this.stopped = false;
    }
    get defaultPrevented() {
      return this.prevented;
    }
    composedPath() {
      return this.path;
    }
    preventDefault() {
      this.prevented = true;
    }
    stopImmediatePropagation() {
      this.stopped = true;
    }
    stopPropagation() {
      this.propagationStopped = true;
    }
    get cancelBubble() {
      return !!(this.propagationStopped || this.stopped);
    }
  }
  class UIEvent extends Event {
    get detail() {
      return this.init.detail;
    }
  }
  class MouseEvent extends UIEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.init = { x: 10, y: 10, button: 0, alt: false, shift: false, meta: false, ctrl: false, stamp: 0, detail: 1, ...init };
    }
    get clientX() {
      return this.init.x;
    }
    get clientY() {
      return this.init.y;
    }
    get button() {
      return this.init.button;
    }
    get altKey() {
      return this.init.alt;
    }
    get shiftKey() {
      return this.init.shift;
    }
    get metaKey() {
      return this.init.meta;
    }
    get ctrlKey() {
      return this.init.ctrl;
    }
  }
  class PageTransitionEvent extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this.kept = !!init.persisted;
    }
    get persisted() {
      return this.kept;
    }
  }
  class Selection {
    get isCollapsed() {
      return !this.text;
    }
  }
  const selected = new Selection();
  selected.text = selection;
  class Document {
    constructor() {
      this.base = null;
    }
    createElement(name) {
      return name === "a" ? new HTMLAnchorElement("a") : new HTMLElement(name);
    }
    querySelector(selector) {
      return selector === "base[target]" && this.base && this.base.hasAttribute("target") ? this.base : null;
    }
    getSelection() {
      return selected;
    }
  }
  const document = new Document();
  const window = { open: (...args) => opened.push(args), setTimeout: (fn) => timers.push(fn) };
  class UserActivation {
    get isActive() {
      return activation.active;
    }
  }
  const activation = { active: false };
  class Navigator {
    get userActivation() {
      return new UserActivation();
    }
  }
  const navigator = new Navigator();
  window.Navigator = Navigator;
  window.UserActivation = UserActivation;
  Object.defineProperty(window, "devicePixelRatio", { get: () => 2 });
  const handlers = Object.create(null);
  const env = {
    apply: Reflect.apply,
    isArray: Array.isArray,
    isTop: top,
    dateNow: () => clock,
    send: (kind, data) => sent.push({ kind, ...data }),
    guard: (fn) =>
      function (...args) {
        return fn.apply(this, args);
      },
    handlers,
    window,
    document,
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    listen: function (type, fn, options) {
      (bubblingOn(this)[type] ??= []).push({ fn, once: !!options?.once });
    },
    unlisten: function (type, fn) {
      const own = bubblingOn(this);
      own[type] = (own[type] ?? []).filter((l) => l.fn !== fn);
    },
    asNative: (native, call) => (...args) => call(native, window, args),
    Navigator,
    UserActivation,
    navigator,
    UIEvent,
    MouseEvent,
    Node,
    Element,
    HTMLAnchorElement,
    HTMLAreaElement,
    HTMLElement,
    Event,
    PageTransitionEvent,
    Document,
    URL,
    Selection,
    isTop: top,
    location: { href: new URL(page).href, origin: new URL(page).origin, hostname: new URL(page).hostname, protocol: new URL(page).protocol },
  };
  new Function(...Object.keys(env), source)(...Object.values(env));
  const dispatch = (e) => {
    for (const fn of listeners[e.type] ?? []) {
      if (e.stopped) break;
      fn(e);
    }
  };
  const fire = (type, path, init = {}, page, on = []) => {
    const chain = [...path, document, window];
    const e = new MouseEvent(type, { path: chain, ...init });
    dispatch(e);
    for (const node of chain) {
      if (e.stopped) break;
      if (node === chain[0]) page?.(e);
      for (const [at, fn] of on) if (at === node && !e.stopped) fn(e);
      const own = bubblingOn(node);
      const after = own[type] ?? [];
      own[type] = after.filter((l) => !l.once);
      for (const l of after) if (!e.stopped) l.fn.call(node, e);
      if (e.propagationStopped) break;
    }
    return e;
  };
  const gesture = (path, keys, { move = 0, release = path, between, page, on } = {}) => {
    fire("mousedown", path, keys);
    between?.();
    fire("mouseup", release, { ...keys, x: 10 + move });
    return fire("click", release, { ...keys, x: 10 + move }, page, on);
  };
  const listenerCount = (type) => [...targets.values()].reduce((n, own) => n + (own[type] ?? []).length, 0);
  const transition = (type, init) => dispatch(new PageTransitionEvent(type, init));
  const flush = () => timers.splice(0).forEach((fn) => fn());
  return {
    document,
    window,
    activation,
    bubbling: bubblingOn(window),
    listenerCount,
    selected,
    transition,
    flush,
    handlers,
    sent,
    opened,
    clicked,
    fire,
    gesture,
    tick: (ms) => (clock += ms),
    link: (href, attrs = {}) => new HTMLAnchorElement("a", { href, ...attrs }),
    div: () => new HTMLElement("div"),
    element: (name, attrs) => new Element(name, attrs),
    svgLink: (href) => new Element("a", { href }, "http://www.w3.org/2000/svg"),
  };
}

const ALT = { alt: true };
const SHIFT = { shift: true };
const peeks = (env) => env.sent.filter((m) => m.kind === "peek");

test("⌥-click on a link posts a peek and cancels Chrome's own action", () => {
  const env = environment();
  env.handlers.peekConfig({ modifier: "alt" });
  const a = env.link("/page");
  const click = env.gesture([a], ALT);
  assert.deepEqual(peeks(env).map((p) => p.url), ["https://page.example/page"]);
  assert.equal(peeks(env)[0].x, 20);
  assert.ok(click.defaultPrevented && click.stopped);
});

test("a press that moves a few points still peeks (Blink sends no click then); a drag doesn't", () => {
  const env = environment();
  env.handlers.peekConfig({ modifier: "alt" });
  const a = env.link("/page");
  env.fire("mousedown", [a], ALT);
  env.fire("mouseup", [a], { ...ALT, x: 14 });
  assert.equal(peeks(env).length, 1);
  env.fire("mousedown", [a], ALT);
  env.fire("mouseup", [a], { ...ALT, x: 20 });
  assert.equal(peeks(env).length, 1);
});

test("after a peek that got no click, the next ordinary click on the link isn't swallowed", () => {
  const env = environment();
  env.handlers.peekConfig({ modifier: "alt" });
  const a = env.link("/page");
  env.fire("mousedown", [a], ALT);
  env.fire("mouseup", [a], { ...ALT, x: 12 });
  assert.equal(peeks(env).length, 1);
  env.tick(200);
  const plain = env.gesture([a], {});
  assert.equal(plain.defaultPrevented, false);
  assert.equal(peeks(env).length, 1);
});

test("the release reads the link again: a changed href peeks the new URL, an added download attribute leaves Chrome's download", () => {
  const env = environment();
  env.handlers.peekConfig({ modifier: "alt" });
  const a = env.link("/old");
  env.gesture([a], ALT, { between: () => a.setAttribute("href", "/new") });
  assert.deepEqual(peeks(env).map((p) => p.url), ["https://page.example/new"]);
  const b = env.link("/file.txt");
  const click = env.gesture([b], ALT, { between: () => b.setAttribute("download", "") });
  assert.equal(peeks(env).length, 1);
  assert.equal(click.defaultPrevented, false);
});

test("links in editable content don't peek (⇧-click extends the selection there)", () => {
  const env = environment();
  env.handlers.peekConfig({ modifier: "shift" });
  const a = env.link("/page");
  a.editable = true;
  const click = env.gesture([a, env.div()], SHIFT);
  assert.equal(peeks(env).length, 0);
  assert.equal(click.defaultPrevented, false);
  const svg = env.svgLink("/svg");
  const host = env.div();
  host.editable = true;
  env.gesture([svg, host], SHIFT);
  assert.equal(peeks(env).length, 0);
});

test("only the chosen key alone peeks; Off and untrusted events never do", () => {
  const env = environment();
  const a = env.link("/page");
  env.handlers.peekConfig({ modifier: "alt" });
  for (const keys of [SHIFT, { alt: true, shift: true }, { alt: true, meta: true }, { alt: true, ctrl: true }, {}]) env.gesture([a], keys);
  env.gesture([a], { ...ALT, trusted: false });
  env.gesture([a], { ...ALT, button: 1 });
  assert.equal(peeks(env).length, 0);
  env.handlers.peekConfig({ modifier: "off" });
  const click = env.gesture([a], ALT);
  assert.equal(peeks(env).length, 0);
  assert.equal(click.defaultPrevented, false);
  env.handlers.peekConfig({ modifier: "shift" });
  env.gesture([a], SHIFT);
  assert.equal(peeks(env).length, 1);
});

test("a release on another element, or on a non-http(s) link, doesn't peek", () => {
  const env = environment();
  env.handlers.peekConfig({ modifier: "alt" });
  const a = env.link("/page");
  env.gesture([a], ALT, { release: [env.link("/other")] });
  env.gesture([env.link("mailto:x@y.z")], ALT);
  env.gesture([env.link("javascript:void 0")], ALT);
  assert.equal(peeks(env).length, 0);
});

test("the peek message carries the key and the page's origin; native's download request is honoured once, for the URL just peeked", () => {
  const env = environment();
  env.handlers.peekConfig({ modifier: "alt" });
  env.gesture([env.link("/doc.pdf")], ALT);
  assert.equal(peeks(env)[0].key, "alt");
  assert.equal(peeks(env)[0].origin, "https://page.example");
  env.handlers.peekRefused({ url: "https://page.example/doc.pdf", reason: "x" });
  env.handlers.peekRefused({ url: "https://page.example/other", reason: "x", download: true });
  assert.equal(env.clicked.length, 0);
  env.handlers.peekRefused({ url: "https://page.example/doc.pdf", reason: "x", download: true });
  assert.equal(env.clicked.length, 1);
  assert.deepEqual(env.clicked[0].attrs, { href: "https://page.example/doc.pdf", download: "" });
  env.handlers.peekRefused({ url: "https://page.example/doc.pdf", reason: "x", download: true });
  assert.equal(env.clicked.length, 1);
  assert.equal(env.opened.length, 0);
});

test("a document restored from the back/forward cache asks for the key again; a leaving one says so", () => {
  const env = environment();
  env.transition("pageshow", { persisted: false });
  assert.equal(env.sent.filter((m) => m.kind === "peekHello").length, 0);
  env.transition("pageshow", { persisted: true });
  env.transition("pageshow", { persisted: true, trusted: false });
  assert.equal(env.sent.filter((m) => m.kind === "peekHello").length, 1);
  env.transition("pagehide", { persisted: true });
  env.transition("pagehide", { persisted: false, trusted: false });
  assert.equal(env.sent.filter((m) => m.kind === "peekGone").length, 1);
});

test("a page's slow mouseup handler doesn't let the peeked gesture's click through", () => {
  const env = environment();
  env.handlers.peekConfig({ modifier: "alt" });
  const a = env.link("/page");
  env.fire("mousedown", [a], { ...ALT, stamp: 50 });
  env.fire("mouseup", [a], { ...ALT, stamp: 60 });
  env.tick(1500);
  const click = env.fire("click", [a], { ...ALT, stamp: 60 });
  assert.equal(peeks(env).length, 1);
  assert.ok(click.defaultPrevented && click.stopped);
});

test("only the peeked gesture's own click is swallowed, not a later one", () => {
  const env = environment();
  env.handlers.peekConfig({ modifier: "alt" });
  const a = env.link("/page");
  env.fire("mousedown", [a], { ...ALT, stamp: 50 });
  env.fire("mouseup", [a], { ...ALT, stamp: 60 });
  const later = env.fire("click", [a], { stamp: 900 });
  assert.equal(later.defaultPrevented, false);
});

test("split keys: ⌥⇧ and ⌥⌘ always split once native says so; ⌥ only when chosen, and Peek's ⌥ wins", () => {
  const env = environment();
  const a = env.link("/page");
  env.handlers.peekConfig({ modifier: "shift", split: "altShift" });
  const altShift = env.gesture([a], { alt: true, shift: true });
  env.gesture([a], { alt: true, meta: true });
  const alt = env.gesture([a], ALT);
  env.gesture([a], { alt: true, shift: true, meta: true });
  env.gesture([a], { alt: true, ctrl: true });
  assert.deepEqual(peeks(env).map((p) => p.key), ["altShift", "altMeta"]);
  assert.ok(altShift.defaultPrevented && altShift.stopped);
  assert.equal(alt.defaultPrevented, false);
  env.handlers.peekConfig({ modifier: "shift", split: "alt" });
  const split = env.gesture([a], ALT);
  env.gesture([a], SHIFT);
  assert.deepEqual(peeks(env).map((p) => p.key), ["altShift", "altMeta", "alt", "shift"]);
  assert.ok(split.defaultPrevented);
  env.handlers.peekConfig({ modifier: "alt", split: "alt" });
  env.gesture([a], ALT);
  assert.equal(peeks(env).at(-1).key, "alt");
  env.handlers.peekConfig({ modifier: "off", split: "alt" });
  env.gesture([a], { alt: true, shift: true });
  env.gesture([a], ALT);
  assert.deepEqual(peeks(env).slice(-2).map((p) => p.key), ["altShift", "alt"]);
});

test("⌥-click split leaves download links, non-http(s) links and editable content to Chrome", () => {
  const env = environment();
  env.handlers.peekConfig({ modifier: "shift", split: "alt" });
  const download = env.gesture([env.link("/file.txt", { download: "" })], ALT);
  env.gesture([env.link("mailto:x@y.z")], ALT);
  const a = env.link("/page");
  a.editable = true;
  env.gesture([a], ALT);
  assert.equal(peeks(env).length, 0);
  assert.equal(download.defaultPrevented, false);
});

test("a press that moves a few points still splits on ⌥ (Blink sends no click then)", () => {
  const env = environment();
  env.handlers.peekConfig({ modifier: "shift", split: "alt" });
  const a = env.link("/page");
  env.fire("mousedown", [a], ALT);
  env.fire("mouseup", [a], { ...ALT, x: 14 });
  env.fire("mousedown", [a], ALT);
  env.fire("mouseup", [a], { ...ALT, x: 20 });
  assert.deepEqual(peeks(env).map((p) => p.key), ["alt"]);
});

const siteConfig = (extra = {}) => ({ modifier: "shift", split: "altShift", otherSites: true, ...extra });

test("with links to other sites on, a plain click on another site's link peeks and cancels the navigation", () => {
  const env = environment();
  env.handlers.peekConfig(siteConfig());
  const click = env.gesture([env.link("https://other.example/story")], {});
  assert.deepEqual(peeks(env).map((p) => [p.url, p.key]), [["https://other.example/story", "site"]]);
  assert.ok(click.defaultPrevented);
  env.gesture([env.link("https://sub.page.example/x")], {});
  assert.deepEqual(peeks(env).map((p) => p.url).at(-1), "https://sub.page.example/x");
});

test("an other-site link the page's own click handler takes (a menu button, #867) never peeks", () => {
  const env = environment();
  env.handlers.peekConfig(siteConfig());
  const a = env.link("https://other.example/products", { role: "button" });
  const handled = env.gesture([a], {}, { page: (e) => e.preventDefault() });
  assert.equal(peeks(env).length, 0);
  assert.ok(handled.defaultPrevented);
  const opened = env.gesture([a], {}, { page: () => a.setAttribute("target", "_blank") });
  assert.equal(peeks(env).length, 0);
  assert.equal(opened.defaultPrevented, false);
  a.setAttribute("target", "_self");
  env.gesture([a], {}, { page: () => a.setAttribute("href", "https://elsewhere.example/") });
  assert.deepEqual(peeks(env).map((p) => p.url), ["https://elsewhere.example/"]);
  env.fire("mousedown", [a], {});
  env.fire("mouseup", [a], {});
  assert.equal(peeks(env).length, 1, "nothing is decided before the click");
});

test("a same-host link carrying another address (www.google.com/url?q=, youtube.com/redirect) goes to the wrapper-aware decision", () => {
  const env = environment({ page: "https://www.google.com" });
  env.handlers.peekConfig(siteConfig());
  const wrapped = env.gesture([env.link("https://www.google.com/url?q=https%3A%2F%2Fother.example%2F&sa=D")], {});
  const raw = env.gesture([env.link("https://www.google.com/redirect?q=https://other.example/")], {});
  const plain = env.gesture([env.link("https://www.google.com/search?q=cats")], {});
  assert.deepEqual(peeks(env).map((p) => p.url), ["https://www.google.com/url?q=https%3A%2F%2Fother.example%2F&sa=D", "https://www.google.com/redirect?q=https://other.example/"]);
  assert.ok(wrapped.defaultPrevented && raw.defaultPrevented);
  assert.equal(plain.defaultPrevented, false);
});

test("links on the same host navigate: relative links, the www. twin, another port", () => {
  const env = environment({ page: "https://www.page.example" });
  env.handlers.peekConfig(siteConfig());
  for (const href of ["/inbox", "https://page.example/a", "https://www.page.example/b", "https://WWW.Page.Example:8443/c", "#top"]) {
    const click = env.gesture([env.link(href)], {});
    assert.equal(click.defaultPrevented, false, href);
  }
  assert.equal(peeks(env).length, 0);
});

test("with links to other sites off (a regular tab, or the setting off), a plain click never peeks", () => {
  const env = environment();
  env.handlers.peekConfig(siteConfig({ otherSites: false }));
  const click = env.gesture([env.link("https://other.example/")], {});
  assert.equal(peeks(env).length, 0);
  assert.equal(click.defaultPrevented, false);
  env.handlers.peekConfig(siteConfig());
  env.gesture([env.link("https://other.example/")], {});
  env.handlers.peekConfig(siteConfig({ otherSites: "yes" }));
  env.gesture([env.link("https://other.example/")], {});
  assert.equal(peeks(env).length, 1);
});

test("modifier clicks keep their meaning: ⌘, ⌃ and ⌥ aren't other-site peeks, ⇧ is still the Peek key", () => {
  const env = environment();
  env.handlers.peekConfig(siteConfig());
  const a = env.link("https://other.example/");
  for (const keys of [{ meta: true }, { ctrl: true }, { meta: true, shift: true }, ALT]) {
    const click = env.gesture([a], keys);
    assert.equal(click.defaultPrevented, false);
  }
  assert.equal(peeks(env).length, 0);
  env.gesture([a], SHIFT);
  assert.deepEqual(peeks(env).map((p) => p.key), ["shift"]);
  env.gesture([a], { button: 1 });
  assert.equal(peeks(env).length, 1);
});

test("links that open elsewhere or download, non-http(s) links and editable content are left to the page", () => {
  const env = environment();
  env.handlers.peekConfig(siteConfig());
  const clicks = [
    env.gesture([env.link("https://other.example/", { target: "_blank" })], {}),
    env.gesture([env.link("https://other.example/", { target: "reader" })], {}),
    env.gesture([env.link("https://other.example/file.zip", { download: "" })], {}),
    env.gesture([env.link("mailto:x@other.example")], {}),
    env.gesture([env.link("ftp://other.example/")], {}),
  ];
  const editable = env.link("https://other.example/");
  editable.editable = true;
  clicks.push(env.gesture([editable], {}));
  assert.equal(peeks(env).length, 0);
  assert.ok(clicks.every((c) => !c.defaultPrevented));
  for (const target of [" _self ", " ", "_blank"]) env.gesture([env.link("https://other.example/", { target })], {});
  env.gesture([env.link(`https://other.example/${"x".repeat(8200)}`)], {});
  assert.equal(peeks(env).length, 0);
  for (const target of ["_self", "_top", "_parent", "", "_SELF"]) env.gesture([env.link("https://other.example/", { target })], {});
  assert.equal(peeks(env).length, 5);
});

test("a <base target> applies to links without their own target", () => {
  const env = environment();
  env.handlers.peekConfig(siteConfig());
  const Anchor = env.link("/").constructor;
  env.document.base = new Anchor("base", { target: "_blank" });
  env.gesture([env.link("https://other.example/")], {});
  assert.equal(peeks(env).length, 0);
  env.gesture([env.link("https://other.example/", { target: "_self" })], {});
  assert.equal(peeks(env).length, 1);
});

test("a click that belongs to a text selection, a drag, a subframe or a file page doesn't peek", () => {
  const selecting = environment({ selection: "selected words" });
  selecting.handlers.peekConfig(siteConfig());
  selecting.gesture([selecting.link("https://other.example/")], {});
  assert.equal(peeks(selecting).length, 0);
  selecting.selected.text = null;
  selecting.gesture([selecting.link("https://other.example/")], {});
  assert.equal(peeks(selecting).length, 1);
  selecting.gesture([selecting.link("https://other.example/")], {}, { move: 12 });
  assert.equal(peeks(selecting).length, 1);
  const frame = environment({ top: false });
  frame.handlers.peekConfig(siteConfig());
  const framed = frame.gesture([frame.link("https://other.example/")], {});
  assert.equal(peeks(frame).length, 0);
  assert.equal(framed.defaultPrevented, false);
  frame.gesture([frame.link("https://other.example/")], SHIFT);
  assert.equal(peeks(frame).length, 1);
  const file = environment({ page: "file:///Users/me/page.html" });
  file.handlers.peekConfig(siteConfig());
  file.gesture([file.link("https://other.example/")], {});
  assert.equal(peeks(file).length, 0);
});

test("when native refuses an other-site peek, the page follows the link it swallowed, once", () => {
  const env = environment();
  env.handlers.peekConfig(siteConfig());
  const a = env.link("https://other.example/story");
  env.gesture([a], {});
  env.handlers.peekRefused({ url: "https://other.example/else", reason: "x", follow: true });
  assert.equal(env.clicked.length, 0);
  env.handlers.peekRefused({ url: "https://other.example/story", reason: "x", follow: true });
  env.handlers.peekRefused({ url: "https://other.example/story", reason: "x", follow: true });
  assert.deepEqual(env.clicked, [a]);
  const svg = env.svgLink("https://other.example/svg");
  env.gesture([svg], {});
  env.handlers.peekRefused({ url: "https://other.example/svg", reason: "x", follow: true });
  assert.equal(env.clicked.length, 2);
  assert.deepEqual(env.clicked[1].attrs, { href: "https://other.example/svg", target: "_self" });
});

const newTabLinks = (env) => env.sent.filter((m) => m.kind === "newTabLink").map((m) => m.url);

test("a plain click on a link that opens a new tab notes it at the end of the click's dispatch, before Chrome opens the tab", () => {
  const env = environment();
  env.gesture([env.link("https://other.example/x", { target: "_blank" })], {});
  assert.deepEqual(newTabLinks(env), ["https://other.example/x"]);
  env.flush();
  assert.deepEqual(newTabLinks(env), ["https://other.example/x"], "noted once");
  env.gesture([env.link("https://other.example/y", { target: "_blank" })], {}, { page: (e) => e.stopPropagation() });
  assert.deepEqual(newTabLinks(env), ["https://other.example/x"], "a stopped click is noted once dispatch is over");
  env.flush();
  assert.deepEqual(newTabLinks(env), ["https://other.example/x", "https://other.example/y"]);
});

test("a hundred clicks the page stops leave no listener behind", () => {
  const env = environment();
  env.handlers.peekConfig(siteConfig());
  for (let i = 0; i < 100; i++) env.gesture([env.link("#stop")], {}, { page: (e) => e.stopPropagation() });
  env.flush();
  assert.equal(env.listenerCount("click"), 0);
  for (let i = 0; i < 100; i++) env.gesture([env.link("https://other.example/", { target: "_blank" })], {});
  env.flush();
  assert.equal(env.listenerCount("click"), 0);
});

test("window.open is noted only while the page has a user activation, with the address resolved", () => {
  const env = environment();
  env.window.open("https://other.example/timer");
  env.activation.active = true;
  env.window.open("/relative", "_blank");
  env.window.open("javascript:void 0");
  env.window.open("");
  env.window.open();
  assert.deepEqual(newTabLinks(env), ["https://page.example/relative"]);
  assert.equal(env.opened.length, 5, "every call still reaches the browser's own window.open");
});

test("a named target or the page's <base target> counts; _self, _top, _parent and no target don't", () => {
  const env = environment();
  for (const target of ["_self", "_TOP", "_parent"]) env.gesture([env.link(`/${target}`, { target })], {});
  env.gesture([env.link("/none")], {});
  env.flush();
  assert.deepEqual(newTabLinks(env), []);
  env.gesture([env.link("/named", { target: "results" })], {});
  env.document.base = env.element("base", { target: "_blank" });
  env.gesture([env.link("/based")], {});
  env.gesture([env.link("/own-self", { target: "_self" })], {});
  env.flush();
  assert.deepEqual(newTabLinks(env), ["https://page.example/named", "https://page.example/based"]);
});

test("a modified, cancelled, untrusted or non-primary click isn't noted", () => {
  const env = environment();
  const blank = (href) => env.link(href, { target: "_blank" });
  for (const keys of [{ meta: true }, { shift: true }, { alt: true }, { ctrl: true }, { meta: true, shift: true }]) env.gesture([blank("/mod")], keys);
  env.fire("click", [blank("/untrusted")], { trusted: false });
  env.fire("click", [blank("/middle")], { button: 1 });
  env.gesture([blank("/cancelled")], {}, { page: (e) => e.preventDefault() });
  env.flush();
  assert.deepEqual(newTabLinks(env), []);
});

test("downloads, non-http(s) links and links in editable content aren't noted", () => {
  const env = environment();
  env.gesture([env.link("/file.zip", { target: "_blank", download: "" })], {});
  env.gesture([env.link("mailto:a@b.example", { target: "_blank" })], {});
  const a = env.link("/edit", { target: "_blank" });
  a.editable = true;
  env.gesture([a, env.div()], {});
  env.flush();
  assert.deepEqual(newTabLinks(env), []);
});

test("a link its click handler rewrites is noted with the address the browser opens", () => {
  const env = environment();
  const a = env.link("/tracked", { target: "_blank" });
  env.gesture([a], {}, { page: () => a.setAttribute("href", "https://other.example/landing") });
  env.flush();
  assert.deepEqual(newTabLinks(env), ["https://other.example/landing"]);
  const b = env.link("/to-script", { target: "_blank" });
  env.gesture([b], {}, { page: () => b.setAttribute("href", "javascript:void 0") });
  env.flush();
  assert.deepEqual(newTabLinks(env), ["https://other.example/landing"]);
});

test("the target is read once click handlers have run: one they add counts, one they clear doesn't", () => {
  const env = environment();
  const plain = env.link("/made-blank");
  env.gesture([plain], {}, { page: () => plain.setAttribute("target", "_blank") });
  const blank = env.link("/made-self", { target: "_blank" });
  env.gesture([blank], {}, { page: () => blank.setAttribute("target", "_self") });
  env.flush();
  assert.deepEqual(newTabLinks(env), ["https://page.example/made-blank"]);
});

const routes = (env) => env.sent.filter((m) => m.kind === "route");
const spec = (pattern) => parseMatchPattern(pattern);
const route = (pattern, over = {}) => ({ spec: pattern === "any" ? "any" : spec(pattern), profile: "work", open: "tab", group: null, ...over });
const WORK = route("*://*.work.example/*");
const routing = (env, list = [WORK]) => env.handlers.routeConfig({ routes: list, self: "personal" });

test("a click on a link another profile's route matches is routed instead of navigating; keyboard, ⌃, ⌥ and same-profile clicks are left to Chrome", () => {
  const env = environment();
  routing(env, [WORK, route("https://page.example/here*", { profile: "personal" })]);
  const a = env.link("https://Work.example/issues/1");
  const click = env.gesture([a], {});
  assert.deepEqual(routes(env), [{ kind: "route", url: "https://work.example/issues/1", how: "foreground", opens: "page", keyed: false, origin: "https://page.example" }]);
  assert.ok(click.defaultPrevented);
  env.gesture([a], { meta: true });
  env.gesture([a], { shift: true });
  env.gesture([a], { meta: true, shift: true });
  assert.deepEqual(routes(env).slice(1).map((r) => [r.how, r.opens, r.keyed]), [["background", "tab", true], ["window", "page", true], ["foreground", "tab", true]]);
  const before = routes(env).length;
  assert.ok(!env.gesture([a], { detail: 0 }).defaultPrevented);
  assert.ok(!env.gesture([a], { ctrl: true }).defaultPrevented);
  assert.ok(!env.gesture([a], { alt: true }).defaultPrevented);
  assert.ok(!env.gesture([env.link("https://page.example/here/?q=1")], {}).defaultPrevented);
  assert.ok(!env.gesture([env.link("https://elsewhere.example/")], {}).defaultPrevented);
  assert.equal(routes(env).length, before);
});

const PARITY = [
  ["*://*.work.example/*", ["https://work.example/", "http://a.b.work.example/x?y=1", "https://evilwork.example/", "https://work.example.evil.test/", "ftp://work.example/x", "https://WORK.example./a"]],
  ["https://*.example.com/docs/*", ["https://www.example.com/docs/a", "https://example.com/docs/", "https://www.example.com/blog/a", "http://www.example.com/docs/a", "https://www.example.com/docs"]],
  ["https://example.com/a%20b*", ["https://example.com/a%20b", "https://example.com/a b/c", "https://example.com/ab"]],
  ["https://example.com:8443/*", ["https://example.com:8443/x", "https://example.com/x", "https://example.com:443/x"]],
  ["http://*/*", ["http://anything.example/", "https://anything.example/", "http://127.0.0.1/x"]],
  ["*://*.example.org/*", ["http://127.0.0.1/", "https://sub.example.org:8080/p", "https://example.org/"]],
  ["http://127.0.0.1/*", ["http://127.0.0.1/x", "http://127.0.0.2/x"]],
  ["https://[::1]/*", ["https://[::1]/a", "https://[::2]/a"]],
  ["https://xn--bcher-kva.example/*", ["https://bücher.example/x", "https://bucher.example/x"]],
  ["https://example.com/*?q=*", ["https://example.com/search?q=1", "https://example.com/search"]],
  ["<all_urls>", ["https://any.example/", "http://other.example/x"]],
  ["any", ["https://any.example/", "http://other.example/x"]],
];

test("the page script matches a route exactly as lib/matchPattern matches a rule", () => {
  for (const [pattern, urls] of PARITY) {
    for (const given of urls) {
      const env = environment();
      routing(env, [route(pattern)]);
      const link = env.link(given);
      const href = new URL(given, "https://page.example/dir/").href;
      const expected = pattern === "any" || matchesUrl(spec(pattern), href);
      assert.equal(env.gesture([link], {}).defaultPrevented, expected, `${pattern} ${href}`);
    }
  }
});

test("a route to the page's own profile routes only where it sends the link somewhere else", () => {
  const own = (over) => route("*://*.work.example/*", { profile: "personal", ...over });
  const cases = [
    [own(), {}, false],
    [own({ profile: null }), {}, false],
    [own({ open: "window" }), {}, true],
    [own({ open: "littleArdia", profile: null }), {}, true],
    [own({ group: "g1" }), {}, true],
    [own({ open: "littleArdia" }), { meta: true }, false],
    [own({ open: "window" }), { shift: true }, false],
    [own({ group: "g1" }), { meta: true }, true],
  ];
  for (const [given, keys, expected] of cases) {
    const env = environment();
    routing(env, [given]);
    assert.equal(env.gesture([env.link("https://work.example/a")], keys).defaultPrevented, expected, JSON.stringify([given, keys]));
  }
  const there = environment({ page: "https://work.example/inbox" });
  routing(there, [own({ open: "window" }), WORK]);
  assert.ok(!there.gesture([there.link("https://work.example/next")], {}).defaultPrevented);
  assert.ok(!there.gesture([there.link("https://work.example/next")], {}).defaultPrevented, "the first matching route decides, a later one doesn't");
  const grouped = environment({ page: "https://work.example/inbox" });
  routing(grouped, [own({ group: "g1" })]);
  assert.ok(!grouped.gesture([grouped.link("https://work.example/next")], {}).defaultPrevented);
  const framed = environment({ top: false, page: "https://work.example/embed" });
  routing(framed, [own({ group: "g1" })]);
  assert.ok(framed.gesture([framed.link("https://work.example/next", { target: "_blank" })], {}).defaultPrevented, "a frame's own address doesn't say where its tab is");
});

test("without the page's own profile (a private window) or without routes, nothing routes", () => {
  const env = environment();
  env.handlers.routeConfig({ routes: [WORK], self: "" });
  assert.ok(!env.gesture([env.link("https://work.example/a")], {}).defaultPrevented);
  routing(env, []);
  assert.ok(!env.gesture([env.link("https://work.example/a")], {}).defaultPrevented);
  env.handlers.routeConfig({ routes: "nonsense", self: "personal" });
  assert.ok(!env.gesture([env.link("https://work.example/a")], {}).defaultPrevented);
  assert.equal(routes(env).length, 0);
});

test("a routed click says whether the link opens a tab; overlong URLs, named targets and frame links stay Chrome's", () => {
  const env = environment();
  routing(env);
  env.gesture([env.link("https://work.example/a", { target: "_blank" })], {});
  env.gesture([env.link("https://work.example/b", { target: "_top" })], {});
  env.gesture([env.link("https://work.example/c", { target: "_self" })], {});
  assert.deepEqual(routes(env).map((r) => r.opens), ["tab", "page", "page"]);
  assert.ok(!env.gesture([env.link("https://work.example/d", { target: "sidebar" })], {}).defaultPrevented);
  assert.ok(!env.gesture([env.link(`https://work.example/${"x".repeat(9000)}`)], {}).defaultPrevented);
  assert.equal(routes(env).length, 3);
  const frame = environment({ top: false });
  routing(frame);
  assert.ok(frame.gesture([frame.link("https://work.example/e", { target: "_blank" })], {}).defaultPrevented);
  assert.ok(frame.gesture([frame.link("https://work.example/f", { target: "_top" })], {}).defaultPrevented);
  assert.ok(!frame.gesture([frame.link("https://work.example/g")], {}).defaultPrevented);
  assert.deepEqual(routes(frame).map((r) => r.opens), ["tab", "page"]);
  assert.ok(frame.gesture([frame.link("https://work.example/h")], { meta: true }).defaultPrevented);
  assert.ok(frame.gesture([frame.link("https://work.example/i", { target: "results" })], { meta: true, shift: true }).defaultPrevented);
  assert.ok(frame.gesture([frame.link("https://work.example/j")], { shift: true }).defaultPrevented);
  assert.deepEqual(routes(frame).slice(2).map((r) => [r.how, r.opens]), [["background", "tab"], ["foreground", "tab"], ["window", "page"]]);
  env.gesture([env.link("https://work.example/k", { target: "_blank" })], { shift: true });
  assert.deepEqual(routes(env).at(-1), { kind: "route", url: "https://work.example/k", how: "window", opens: "page", keyed: true, origin: "https://page.example" });
});

test("a routed click takes the page's <base target>: _blank opens a tab, a named frame stays Chrome's", () => {
  const env = environment();
  routing(env);
  env.document.base = env.element("base", { target: "_blank" });
  env.gesture([env.link("https://work.example/based")], {});
  env.gesture([env.link("https://work.example/own", { target: "_self" })], {});
  assert.deepEqual(routes(env).map((r) => [r.url, r.opens]), [["https://work.example/based", "tab"], ["https://work.example/own", "page"]]);
  env.document.base = env.element("base", { target: "results" });
  assert.ok(!env.gesture([env.link("https://work.example/framed")], {}).defaultPrevented);
  assert.equal(routes(env).length, 2);
});

test("a route waits for the page's own click handlers: a click they cancel stays theirs, a link they rewrite routes by its new address", () => {
  const env = environment();
  routing(env);
  const a = env.link("https://work.example/menu");
  const handled = env.gesture([a], {}, { page: (e) => e.preventDefault() });
  assert.ok(handled.defaultPrevented);
  assert.deepEqual(routes(env), []);
  const b = env.link("https://page.example/out");
  const rewritten = env.gesture([b], {}, { page: () => b.setAttribute("href", "https://work.example/landing") });
  assert.ok(rewritten.defaultPrevented);
  assert.deepEqual(routes(env).map((r) => r.url), ["https://work.example/landing"]);
});

test("a routed click native refuses follows the link the click cancelled, once and only for the URL it sent", () => {
  const env = environment();
  routing(env);
  const a = env.link("https://work.example/slow");
  env.gesture([a], {});
  env.handlers.routeRefused({ url: "https://work.example/other" });
  assert.equal(env.clicked.length, 0);
  env.handlers.routeRefused({ url: "https://work.example/slow" });
  env.handlers.routeRefused({ url: "https://work.example/slow" });
  assert.deepEqual(env.clicked, [a]);
  for (const keys of [{ meta: true }, { shift: true }, { meta: true, shift: true }]) {
    env.gesture([env.link("https://work.example/keys")], keys);
    env.handlers.routeRefused({ url: "https://work.example/keys" });
  }
  assert.deepEqual(env.clicked, [a]);
});

test("a route wins over links to other sites: the click is routed, not peeked", () => {
  const env = environment();
  env.handlers.peekConfig(siteConfig());
  routing(env, [route("*://other.example/*")]);
  const click = env.gesture([env.link("https://other.example/story")], {});
  assert.equal(peeks(env).length, 0);
  assert.deepEqual(routes(env).map((r) => [r.url, r.how]), [["https://other.example/story", "foreground"]]);
  assert.ok(click.defaultPrevented);
  env.gesture([env.link("https://elsewhere.example/")], {});
  assert.deepEqual(peeks(env).map((p) => p.url), ["https://elsewhere.example/"]);
});

test("a page handler that stops the click's propagation still has it routed, once, wherever it sits on the path", () => {
  const stopping = (e) => e.stopPropagation();
  const cases = [
    ["the link itself", (env, link) => ({ path: [link], on: [[link, stopping]] })],
    ["a descendant of the link", (env, link) => {
      const span = env.div();
      return { path: [span, link], on: [[span, stopping]] };
    }],
    ["an ancestor, as React's root does", (env, link) => {
      const root = env.div();
      return { path: [link, root], on: [[root, stopping]] };
    }],
  ];
  for (const [where, build] of cases) {
    const env = environment();
    routing(env);
    const link = env.link("https://work.example/stopped");
    const { path, on } = build(env, link);
    const click = env.gesture(path, {}, { on });
    assert.ok(click.defaultPrevented, where);
    assert.deepEqual(routes(env).map((r) => r.url), ["https://work.example/stopped"], where);
    env.flush();
    assert.equal(routes(env).length, 1, where);
    assert.equal(env.listenerCount("click"), 0, where);
  }
});

test("a page handler that prevents the click keeps it, with or without stopping it; an unstopped click routes once and leaves no listener", () => {
  for (const handler of [(e) => e.preventDefault(), (e) => (e.preventDefault(), e.stopPropagation())]) {
    const env = environment();
    routing(env);
    const link = env.link("https://work.example/handled");
    const root = env.div();
    env.gesture([link, root], {}, { on: [[root, handler]] });
    env.flush();
    assert.equal(routes(env).length, 0);
    assert.equal(env.listenerCount("click"), 0);
  }
  const env = environment();
  routing(env);
  const link = env.link("https://work.example/plain");
  env.gesture([link, env.div()], {});
  env.flush();
  assert.equal(routes(env).length, 1);
  assert.equal(env.listenerCount("click"), 0);
  env.gesture([link, env.div()], { meta: true }, { on: [[link, (e) => e.stopPropagation()]] });
  assert.deepEqual(routes(env).at(-1), { kind: "route", url: "https://work.example/plain", how: "background", opens: "tab", keyed: true, origin: "https://page.example" });
});

test("a link handler that stops a click to a site the rule doesn't take leaves it to Chrome", () => {
  const env = environment();
  routing(env);
  const link = env.link("https://elsewhere.example/");
  const click = env.gesture([link], {}, { on: [[link, (e) => e.stopPropagation()]] });
  env.flush();
  assert.ok(!click.defaultPrevented);
  assert.equal(routes(env).length, 0);
  assert.equal(env.listenerCount("click"), 0);
});
