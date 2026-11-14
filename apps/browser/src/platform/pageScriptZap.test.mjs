import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("  const ZAP_MAX_MATCHES = 100;\n");
const end = script.indexOf("\n  return receive;\n})", start);
assert.ok(start > 0 && end > start, "page_script.js has the zap block");
const source = script.slice(start, end);

const escapeCss = (text) => String(text).replace(/[^\w-]/g, (c) => `\\${c}`);
const unescapeCss = (text) => text.replace(/\\(.)/g, "$1");

function splitTop(text) {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      current += c + text[++i];
      continue;
    }
    if (c === '"') quoted = !quoted;
    else if (!quoted && (c === "[" || c === "(")) depth++;
    else if (!quoted && (c === "]" || c === ")")) depth--;
    if (c === " " && !quoted && depth === 0) {
      if (current) parts.push(current);
      current = "";
    } else current += c;
  }
  if (current) parts.push(current);
  return parts;
}

const PIECES = [
  [/^([A-Za-z][\w-]*)/, (m) => ({ tag: m[1] })],
  [/^#((?:\\.|[\w-])+)/, (m) => ({ id: unescapeCss(m[1]) })],
  [/^\.((?:\\.|[\w-])+)/, (m) => ({ cls: unescapeCss(m[1]) })],
  [/^\[([\w-]+)(?:([\^$]?)="((?:[^"\\]|\\.)*)")?\]/, (m) => ({ attr: m[1], op: m[2], value: m[3] === undefined ? undefined : unescapeCss(m[3]) })],
  [/^:first-child/, () => ({ first: true })],
  [/^:last-child/, () => ({ last: true })],
  [/^:nth-child\((\d+)\)/, (m) => ({ nth: +m[1] })],
  [/^:has\((.*)\)$/, (m) => ({ has: splitTop(m[1]) })],
];

function parseCompound(text) {
  const parts = [];
  let rest = text;
  while (rest) {
    const hit = PIECES.map(([pattern, build]) => [pattern.exec(rest), build]).find(([m]) => m);
    if (!hit) throw new SyntaxError(`bad selector ${text}`);
    parts.push(hit[1](hit[0]));
    rest = rest.slice(hit[0][0].length);
  }
  return parts;
}

function holds(el, part) {
  if (part.tag) return el.localName === part.tag;
  if (part.id) return el.getAttribute("id") === part.id;
  if (part.cls) return el.classList.includes(part.cls);
  if (part.attr) {
    const value = el.getAttribute(part.attr);
    if (value === null) return false;
    if (part.value === undefined) return true;
    if (part.op === "^") return value.startsWith(part.value);
    if (part.op === "$") return value.endsWith(part.value);
    return value === part.value;
  }
  const siblings = el.parentElement ? el.parentElement.children : [el];
  if (part.first) return siblings[0] === el;
  if (part.last) return siblings[siblings.length - 1] === el;
  if (part.nth) return siblings.indexOf(el) + 1 === part.nth;
  return hasBelow(el, part.has, false);
}

function hasBelow(el, tokens, direct) {
  if (tokens[0] === ">") return hasBelow(el, tokens.slice(1), true);
  const [first, ...rest] = tokens;
  const pool = direct ? el.children : descendants(el);
  const compound = parseCompound(first);
  return pool.some((node) => compound.every((part) => holds(node, part)) && (!rest.length || hasBelow(node, rest, rest[0] === ">")));
}

function descendants(el) {
  return el.children.flatMap((child) => [child, ...descendants(child)]);
}

function matchFrom(el, tokens, i) {
  if (!parseCompound(tokens[i]).every((part) => holds(el, part))) return false;
  if (i === 0) return true;
  if (tokens[i - 1] === ">") return !!el.parentElement && matchFrom(el.parentElement, tokens, i - 2);
  for (let up = el.parentElement; up; up = up.parentElement) if (matchFrom(up, tokens, i - 1)) return true;
  return false;
}

function query(root, selector) {
  const tokens = splitTop(selector);
  return descendants(root).filter((el) => matchFrom(el, tokens, tokens.length - 1));
}

class FakeElement {
  constructor(localName, attrs = {}, children = [], style = {}) {
    this.localName = localName;
    this.attrs = { ...attrs };
    this.children = [];
    this.parentElement = null;
    this.look = { fontFamily: "A", fontSize: "16px", color: "black", backgroundColor: "white", textDecoration: "none", fontWeight: "400", ...style };
    this.style = { cssText: "" };
    this.rect = { left: 1, top: 2, width: 30, height: 40 };
    this.append(...children);
  }
  get attributes() {
    return Object.entries(this.attrs).map(([name, value]) => ({ name, value }));
  }
  get classList() {
    return (this.attrs.class ?? "").split(/\s+/).filter(Boolean);
  }
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.remove?.();
      node.parentElement = this;
      this.children.push(node);
    }
  }
  replaceChildren(...nodes) {
    for (const child of this.children) child.parentElement = null;
    this.children = [];
    this.append(...nodes);
  }
  remove() {
    if (!this.parentElement) return;
    this.parentElement.children = this.parentElement.children.filter((c) => c !== this);
    this.parentElement = null;
  }
  attachShadow() {
    this.shadow = new FakeElement("shadow");
    return this.shadow;
  }
  getBoundingClientRect() {
    return this.rect;
  }
  querySelectorAll(selector) {
    return query(this, selector);
  }
}

const el = (localName, attrs, children, style) => new FakeElement(localName, attrs, children, style);

function page(build) {
  const html = el("html");
  const body = el("body");
  html.append(body);
  build(body);
  const sent = [];
  const listeners = [];
  const frames = [];
  const document = {
    documentElement: html,
    hit: null,
    querySelectorAll: (selector) => query(html, selector),
    createElement: (name) => el(name),
    elementFromPoint: () => document.hit,
    readyState: "complete",
  };
  const handlers = Object.create(null);
  const treeSizeWhenStyled = [];
  const env = {
    handlers,
    send: (kind, data) => sent.push({ kind, data }),
    guard: (fn) => fn,
    apply: Reflect.apply,
    raf: (fn) => frames.push(fn),
    window: {},
    isFinite: Number.isFinite,
    document,
    CSS: { escape: escapeCss },
    getComputedStyle: (node) => {
      treeSizeWhenStyled.push(html.children.length);
      return node.look;
    },
    addEventListener: (type, fn, capture) => listeners.push({ type, fn, capture }),
    removeEventListener: (type, fn) => {
      const at = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (at >= 0) listeners.splice(at, 1);
    },
  };
  new Function(...Object.keys(env), source)(...Object.values(env));
  const dispatch = (type, init = {}) => {
    const event = { type, isTrusted: true, button: 0, clientX: 5, clientY: 6, ...init, defaultPrevented: false, stopped: false };
    event.preventDefault = () => (event.defaultPrevented = true);
    event.stopImmediatePropagation = () => (event.stopped = true);
    for (const l of [...listeners]) if (l.type === type && !event.stopped) l.fn(event);
    return event;
  };
  const flush = () => frames.splice(0).forEach((fn) => fn());
  return { html, body, document, handlers, sent, listeners, dispatch, flush, treeSizeWhenStyled };
}

const feed = (body) =>
  body.append(
    el("header", { class: "site-header" }, [el("nav", { class: "main-nav" }, [el("a", { href: "/a" }), el("a", { href: "/b" })])]),
    el("main", { id: "content" }, [
      el("div", { class: "feed" }, [1, 2, 3, 4, 5].map((n) => el("div", { class: "post-card", "data-n": String(n) }, [el("h2", { class: "post-title" }), el("p", { class: "excerpt" })]))),
      el("aside", { class: "sidebar-widget" }, [el("div", { class: "x7Kq9zB promo-banner" })]),
    ]),
  );

const pick = (t, target) => {
  t.handlers.zapStart({});
  t.document.hit = target;
  t.dispatch("click");
  return t.sent.filter((m) => m.kind === "zapPicked").map((m) => m.data);
};

test("picking one of several cards offers a unique selector first and the whole group last", () => {
  const t = page(feed);
  const cards = query(t.html, ".post-card");
  const [first] = pick(t, cards[1]);
  assert.equal(first.matches, 1);
  assert.deepEqual(query(t.html, first.selector), [cards[1]]);
  assert.ok(first.levels >= 2);
  for (let level = 1; level < first.levels; level++) t.handlers.zapRelated({ level });
  const reports = t.sent.filter((m) => m.kind === "zapPicked").map((m) => m.data);
  assert.equal(reports.length, first.levels);
  const counts = reports.map((r) => r.matches);
  assert.deepEqual(counts, [...counts].sort((a, b) => a - b));
  assert.equal(new Set(counts).size, counts.length);
  assert.ok(reports.some((r) => r.matches === 5 && r.selector.includes(".post-card")));
  for (const r of reports) assert.ok(query(t.html, r.selector).includes(cards[1]), r.selector);
  assert.ok(reports.length <= 15);
});

test("a readable class beats a gibberish one when both match the same elements", () => {
  const t = page(feed);
  const banner = query(t.html, ".promo-banner")[0];
  const reports = pick(t, banner);
  const unique = reports.find((r) => r.matches === 1);
  assert.ok(unique);
  assert.ok(!reports.some((r) => r.selector === ".x7Kq9zB"));
});

test("selectors that match more than 100 elements are dropped", () => {
  const t = page((body) => body.append(el("ul", { class: "rows" }, Array.from({ length: 150 }, () => el("li", { class: "row" })))));
  const rows = query(t.html, ".row");
  t.handlers.zapStart({});
  t.document.hit = rows[7];
  t.dispatch("click");
  for (let level = 1; level < t.sent.at(-1).data.levels; level++) t.handlers.zapRelated({ level });
  const reports = t.sent.map((m) => m.data);
  assert.ok(reports.length > 0);
  for (const r of reports) assert.ok(r.matches <= 100 && r.selector !== ".row" && r.selector !== "li", r.selector);
});

test("selectors that also match inside the picked element are dropped", () => {
  const t = page((body) => body.append(el("div", { class: "card" }, [el("div", { class: "card inner" })]), el("div", { class: "card" })));
  const [outer] = query(t.html, "body > .card");
  t.handlers.zapStart({});
  t.document.hit = outer;
  t.dispatch("click");
  const first = t.sent.at(-1).data;
  for (let level = 1; level < first.levels; level++) t.handlers.zapRelated({ level });
  for (const { data } of t.sent) assert.notEqual(data.selector, ".card");
});

test("among selectors matching the same count, the one whose matches look alike wins", () => {
  const t = page((body) =>
    body.append(
      el("hr"),
      el("section", {}, [
        el("div", { class: "list-item entry-block" }),
        el("div", { class: "entry-block" }),
        el("div", { class: "entry-block" }),
        el("div", { class: "list-item" }, [], { color: "red" }),
        el("div", { class: "list-item" }),
      ]),
      el("hr"),
    ),
  );
  const target = query(t.html, ".entry-block")[0];
  t.handlers.zapStart({});
  t.document.hit = target;
  t.dispatch("click");
  const first = t.sent.at(-1).data;
  for (let level = 1; level < first.levels; level++) t.handlers.zapRelated({ level });
  const three = t.sent.map((m) => m.data).filter((r) => r.matches === 3);
  assert.equal(three.length, 1);
  const looks = query(t.html, three[0].selector).map((node) => node.look.color);
  assert.equal(new Set(looks).size, 1, three[0].selector);
});

test("attributes with names that can't be selectors are skipped", () => {
  const t = page((body) => body.append(el("button", { "@click": "go()", class: "buy-button" }), el("button", { class: "buy-button" })));
  const reports = pick(t, query(t.html, "button")[0]);
  assert.ok(reports.length > 0);
  assert.ok(reports.every((r) => !r.selector.includes("@click")));
});

test("zapRelated clamps the level and does nothing before a pick", () => {
  const t = page(feed);
  t.handlers.zapStart({});
  t.handlers.zapRelated({ level: 1 });
  assert.equal(t.sent.filter((m) => m.kind === "zapPicked").length, 0);
  t.document.hit = query(t.html, ".post-card")[0];
  t.dispatch("click");
  const { levels } = t.sent.at(-1).data;
  t.handlers.zapRelated({ level: 999 });
  assert.equal(t.sent.at(-1).data.matches, Math.max(...t.sent.map((m) => m.data.matches)));
  t.handlers.zapRelated({ level: -3 });
  assert.equal(t.sent.at(-1).data.matches, 1);
  t.handlers.zapRelated({ level: "x" });
  t.handlers.zapRelated({});
  assert.equal(t.sent.at(-1).data.levels, levels);
});

test("while the picker is on, clicks and mouse presses are swallowed and only a trusted click picks", () => {
  const t = page(feed);
  t.handlers.zapStart({});
  t.document.hit = query(t.html, ".post-card")[0];
  for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup", "dblclick", "auxclick"]) {
    const e = t.dispatch(type);
    assert.ok(e.defaultPrevented && e.stopped, type);
  }
  const forged = t.dispatch("click", { isTrusted: false });
  assert.ok(forged.defaultPrevented && forged.stopped);
  const right = t.dispatch("click", { button: 2 });
  assert.ok(right.defaultPrevented && right.stopped);
  assert.equal(t.sent.length, 0);
  const real = t.dispatch("click");
  assert.ok(real.defaultPrevented && real.stopped);
  assert.equal(t.sent.length, 1);
  assert.equal(t.sent[0].kind, "zapPicked");
});

test("hover and picked outlines are drawn on a fixed, click-through overlay", () => {
  const t = page(feed);
  t.handlers.zapStart({});
  const host = t.html.children.at(-1);
  assert.equal(host.localName, "ardia-zap");
  assert.match(host.style.cssText, /position:fixed!important/);
  assert.match(host.style.cssText, /pointer-events:none!important/);
  const [hoverLayer, pickedLayer] = host.shadow.children.slice(1);
  const card = query(t.html, ".post-card")[0];
  t.document.hit = card;
  t.dispatch("mousemove");
  t.dispatch("mousemove");
  t.flush();
  assert.equal(hoverLayer.children.length, 1);
  assert.match(hoverLayer.children[0].style.cssText, /left:1px;top:2px;width:30px;height:40px/);
  t.dispatch("click");
  assert.equal(pickedLayer.children.length, 1);
  card.rect = { left: 0, top: 0, width: 0, height: 0 };
  t.dispatch("scroll");
  t.flush();
  assert.equal(pickedLayer.children.length, 0);
});

test("the overlay is out of the tree while selectors are built", () => {
  const t = page(feed);
  pick(t, query(t.html, ".post-card")[0]);
  assert.ok(t.treeSizeWhenStyled.length > 0);
  assert.ok(t.treeSizeWhenStyled.every((n) => n === 1));
  assert.equal(t.html.children.length, 2);
});

test("zapStop removes the overlay and stops swallowing events, and zapStart twice adds one overlay", () => {
  const t = page(feed);
  t.handlers.zapStart({});
  t.handlers.zapStart({});
  assert.equal(t.html.children.filter((c) => c.localName === "ardia-zap").length, 1);
  assert.ok(t.dispatch("click").defaultPrevented);
  t.handlers.zapStop({});
  assert.equal(t.html.children.filter((c) => c.localName === "ardia-zap").length, 0);
  const e = t.dispatch("click");
  assert.ok(!e.defaultPrevented);
  t.handlers.zapStop({});
  t.handlers.zapStart({});
  assert.ok(t.dispatch("click").defaultPrevented);
});
