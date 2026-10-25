import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("  let peekKey = null;\n");
const end = script.indexOf("  } catch (e) {}\n", start);
assert.ok(start > 0 && end > start, "page_script.js has the peek block");
const source = `${script.slice(start, end)}  } catch (e) {\n    throw e;\n  }\n`;

const XHTML = "http://www.w3.org/1999/xhtml";
const BASE = "https://page.example/dir/";

function environment() {
  const sent = [];
  const opened = [];
  const clicked = [];
  const listeners = {};
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
  }
  class HTMLAreaElement extends HTMLElement {
    get href() {
      return new URL(this.attrs.href, BASE).href;
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
      this.defaultPrevented = false;
      this.stopped = false;
    }
    composedPath() {
      return this.path;
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
    stopImmediatePropagation() {
      this.stopped = true;
    }
  }
  class MouseEvent extends Event {
    constructor(type, init = {}) {
      super(type, init);
      this.init = { x: 10, y: 10, button: 0, alt: false, shift: false, meta: false, ctrl: false, stamp: 0, ...init };
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
  class Document {
    createElement(name) {
      return name === "a" ? new HTMLAnchorElement("a") : new HTMLElement(name);
    }
  }
  const document = new Document();
  const window = { open: (...args) => opened.push(args) };
  Object.defineProperty(window, "devicePixelRatio", { get: () => 2 });
  const handlers = Object.create(null);
  const env = {
    apply: Reflect.apply,
    dateNow: () => clock,
    send: (kind, data) => sent.push({ kind, ...data }),
    guard: (fn) =>
      function (...args) {
        return fn.apply(this, args);
      },
    handlers,
    window,
    document,
    addEventListener: (type, fn) => (listeners[type] = fn),
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
    location: { origin: "https://page.example" },
  };
  new Function(...Object.keys(env), source)(...Object.values(env));
  const fire = (type, path, init = {}) => {
    const e = new MouseEvent(type, { path: [...path, document, window], ...init });
    listeners[type](e);
    return e;
  };
  const gesture = (path, keys, { move = 0, release = path, between } = {}) => {
    fire("mousedown", path, keys);
    between?.();
    fire("mouseup", release, { ...keys, x: 10 + move });
    return fire("click", release, { ...keys, x: 10 + move });
  };
  const transition = (type, init) => listeners[type](new PageTransitionEvent(type, init));
  return {
    transition,
    handlers,
    sent,
    opened,
    clicked,
    fire,
    gesture,
    tick: (ms) => (clock += ms),
    link: (href, attrs = {}) => new HTMLAnchorElement("a", { href, ...attrs }),
    div: () => new HTMLElement("div"),
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
