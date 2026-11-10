import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("../ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("  try {\n    const vaultValue");
const end = script.indexOf("\n  } catch (e) {}", start);
assert.ok(start > 0 && end > start, "page_script.js has the vault block");
const vaultBlock = script.slice(start + "  try {\n".length, end);

const focusState = { el: null };
const simple = (sel) => {
  if (sel.trim() === ":focus") return (el) => el === focusState.el;
  const m = sel.trim().match(/^([a-z*]*)((?:\[[^\]]+\])*)$/i);
  assert.ok(m, `the fake DOM understands ${sel}`);
  const attrs = [...m[2].matchAll(/\[([a-z-]+)(?:(\^?=)"?([^"\]]*)"?)?\]/gi)].map((a) => [a[1], a[3], a[2]]);
  return (el) =>
    (!m[1] || m[1] === "*" || el.tagName === m[1].toUpperCase()) &&
    attrs.every(([name, value, op]) =>
        value === undefined ? el.getAttribute(name) !== null : op === "^=" ? (el.getAttribute(name) ?? "").startsWith(value) : el.getAttribute(name) === value,
      );
};
const matcher = (selector) => {
  const parts = selector.split(",").map(simple);
  return (el) => parts.some((p) => p(el));
};

function makePage({ origin = "https://example.com", path = "/login", top = true, scheme = "normal", media = {}, requestSubmit = true } = {}) {
  const sent = [];
  const frames = [];
  const focused = [];
  const clock = { now: 1_000_000, timers: [], seq: 0 };
  const listenersOf = (type) => [win, document].flatMap((t) => t.listeners.filter((l) => l.type === type));
  const deliver = (target, event) => {
    Object.assign(event, { target, path: pathOf(target) });
    for (const l of listenersOf(event.type)) if (!event.stopped) l.fn(event);
  };
  class FakeTarget {
    constructor() {
      this.listeners = [];
      this.dispatched = [];
      this.events = [];
    }
    addEventListener(type, fn, options) {
      this.listeners.push({ type, fn, capture: options === true || !!(options && options.capture) });
    }
    dispatchEvent(e) {
      this.dispatched.push(e.type);
      this.events.push(e);
      if (this instanceof FakeNode) deliver(this, e);
      return !e.defaultPrevented;
    }
  }
  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = !!init.bubbles;
      this.composed = !!init.composed;
      this.cancelable = !!init.cancelable;
      this.defaultPrevented = false;
      this.stopped = false;
      this.isTrusted = false;
    }
    composedPath() {
      return this.path || [];
    }
    preventDefault() {
      if (this.cancelable !== false) this.defaultPrevented = true;
    }
    stopImmediatePropagation() {
      this.stopped = true;
    }
  }
  class FakeKeyboardEvent extends FakeEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.key = init.key || "";
      this.code = init.code || "";
    }
    get keyCode() {
      return 0;
    }
    get which() {
      return 0;
    }
    get charCode() {
      return 0;
    }
  }
  const camel = (name) => name.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  class FakeStyle {
    constructor() {
      Object.defineProperty(this, "priorities", { value: {}, enumerable: false });
    }
    getPropertyValue(name) {
      return this[camel(name)] ?? "";
    }
    getPropertyPriority(name) {
      return this.priorities[camel(name)] ?? "";
    }
    setProperty(name, value, priority = "") {
      this[camel(name)] = String(value);
      if (priority) this.priorities[camel(name)] = priority;
      else delete this.priorities[camel(name)];
    }
    removeProperty(name) {
      const old = this.getPropertyValue(name);
      delete this[camel(name)];
      delete this.priorities[camel(name)];
      return old;
    }
  }
  class FakeNode extends FakeTarget {
    constructor() {
      super();
      this.parentNode = null;
      this.children = [];
    }
    get parentElement() {
      return this.parentNode instanceof FakeElement ? this.parentNode : null;
    }
    append(...kids) {
      for (const kid of kids) {
        kid.parentNode = this;
        this.children.push(kid);
      }
      return this;
    }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
      this.parentNode = null;
    }
    descendants() {
      const out = [];
      const walk = (n) => {
        for (const c of n.children) {
          out.push(c);
          walk(c);
        }
      };
      walk(this);
      return out;
    }
    querySelectorAll(selector) {
      return this.descendants().filter(matcher(selector));
    }
  }
  class FakeElement extends FakeNode {
    constructor(tag, attrs = {}) {
      super();
      this.tagName = tag.toUpperCase();
      this.nodeType = 1;
      this.attrs = { ...attrs };
      this.textContent = attrs.text || "";
      delete this.attrs.text;
      this.inlineStyle = new FakeStyle();
      this.rect = { left: 10, top: 20, width: 200, height: 30 };
    }
    get style() {
      return this.inlineStyle;
    }
    getAttribute(name) {
      return Object.hasOwn(this.attrs, name) ? String(this.attrs[name]) : null;
    }
    closest(selector) {
      const test = matcher(selector);
      for (let n = this; n instanceof FakeElement; n = n.parentNode) if (test(n)) return n;
      return null;
    }
    get isConnected() {
      let n = this;
      while (n.parentNode || n.host) n = n.parentNode || n.host;
      return n === document;
    }
    getBoundingClientRect() {
      return { ...this.rect, x: this.rect.left, y: this.rect.top };
    }
    attachShadow() {
      this.shadowRoot = new FakeFragment();
      this.shadowRoot.host = this;
      return this.shadowRoot;
    }
  }
  class FakeHTMLElement extends FakeElement {
    get style() {
      return this.inlineStyle;
    }
    focus() {
      focused.push(this);
    }
    click() {
      this.clicks = (this.clicks || 0) + 1;
      this.dispatchEvent(new FakeEvent("click", { bubbles: true, cancelable: true }));
    }
  }
  class FakeForm extends FakeHTMLElement {
    constructor(attrs = {}) {
      super("form", attrs);
      this.requested = 0;
    }
    requestSubmit() {
      this.requested++;
      fire(this, "submit");
    }
  }
  if (!requestSubmit) FakeForm.prototype.requestSubmit = undefined;
  class FakeInput extends FakeHTMLElement {
    constructor(attrs = {}) {
      super("input", attrs);
      this.raw = attrs.value ?? "";
      this.checkedState = "checked" in attrs;
    }
    get value() {
      return this.raw;
    }
    set value(v) {
      this.raw = String(v);
    }
    get checked() {
      return this.checkedState;
    }
    get maxLength() {
      const n = parseInt(this.attrs.maxlength, 10);
      return Number.isFinite(n) ? n : -1;
    }
    get type() {
      return String(this.attrs.type || "text").toLowerCase();
    }
    get form() {
      return this.closest("form");
    }
    get disabled() {
      return "disabled" in this.attrs;
    }
    get readOnly() {
      return "readonly" in this.attrs;
    }
  }
  class FakeButton extends FakeHTMLElement {
    constructor(attrs = {}) {
      super("button", attrs);
    }
    get type() {
      return String(this.attrs.type || "submit").toLowerCase();
    }
    get disabled() {
      return "disabled" in this.attrs;
    }
  }
  class FakeFragment extends FakeNode {}
  class FakeDocument extends FakeNode {}
  const document = new FakeDocument();
  const html = new FakeHTMLElement("html");
  const body = new FakeHTMLElement("body");
  document.append(html);
  html.append(body);
  document.documentElement = html;
  const win = new FakeTarget();
  win.getComputedStyle = (el) => ({
    visibility: el.style.visibility || "visible",
    display: el.style.display || "block",
    opacity: el.style.opacity ?? "1",
    colorScheme: el.style.colorScheme || scheme,
  });
  const selection = { text: "" };
  win.getSelection = () => ({ toString: () => selection.text });
  win.requestAnimationFrame = (fn) => frames.push(fn);
  win.matchMedia = (query) => ({ matches: !!media[query] });
  win.setTimeout = (fn, ms) => {
    const id = ++clock.seq;
    clock.timers.push({ id, at: clock.now + ms, fn });
    return id;
  };
  win.clearTimeout = (id) => {
    clock.timers = clock.timers.filter((t) => t.id !== id);
  };
  const advance = (ms) => {
    const until = clock.now + ms;
    for (;;) {
      const due = clock.timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      clock.timers = clock.timers.filter((t) => t !== due);
      clock.now = due.at;
      due.fn();
    }
    clock.now = until;
  };
  const runFrames = (rounds = 1) => {
    for (let i = 0; i < rounds; i++) {
      const batch = frames.splice(0);
      for (const fn of batch) fn();
    }
  };
  const handlers = Object.create(null);
  const location = { origin, hostname: new URL(origin).hostname, pathname: path };
  const context = {
    window: win,
    document,
    location,
    Date: { now: () => clock.now },
    HTMLInputElement: FakeInput,
    HTMLFormElement: FakeForm,
    HTMLElement: FakeHTMLElement,
    Element: FakeElement,
    EventTarget: FakeTarget,
    Event: FakeEvent,
    KeyboardEvent: FakeKeyboardEvent,
    CSSStyleDeclaration: FakeStyle,
    DocumentFragment: FakeFragment,
    apply: Reflect.apply,
    guard: (fn) => fn,
    handlers,
    isTop: top,
    revealedField: null,
    send: (kind, data) => sent.push({ kind, data: JSON.parse(JSON.stringify(data)) }),
  };
  const exports = runInNewContext(`${vaultBlock}\n;({ vaultClassify, vaultTokens })`, context);
  const input = (attrs) => new FakeInput(attrs);
  const el = (tag, attrs, ...kids) => (tag === "form" ? new FakeForm(attrs) : new FakeHTMLElement(tag, attrs)).append(...kids);
  const pathOf = (target) => {
    const path = [];
    for (let n = target; n; n = n.parentNode || n.host) path.push(n);
    path.push(win);
    return path;
  };
  focusState.el = null;
  const fire = (target, type, extra = {}) => {
    if (type === "focusin") focusState.el = target;
    if (type === "focusout" && focusState.el === target) focusState.el = null;
    const event = new FakeEvent(type, { cancelable: true, bubbles: true });
    Object.assign(event, { isTrusted: true, target, path: pathOf(target) }, extra);
    for (const t of [win, document]) for (const l of t.listeners) if (l.type === type && !event.stopped) l.fn(event);
    return event;
  };
  const type = (field, value, extra) => {
    field.value = value;
    fire(field, "input", extra);
  };
  const of = (kind) => sent.filter((m) => m.kind === kind).map((m) => m.data);
  return { ...exports, sent, of, frames, runFrames, advance, clock, location, focused, document, html, body, input, el, fire, type, handlers, FakeButton, FakeEvent, win, selection };
}

const loginForm = (page, extra = {}) => {
  const user = page.input({ type: "email", name: "email", autocomplete: "username" });
  const pass = page.input({ type: "password", name: "password", autocomplete: "current-password" });
  const button = new page.FakeButton({ text: "Sign in" });
  const form = page.el("form", { action: "/session", ...extra }, user, pass, button);
  page.body.append(form);
  return { user, pass, button, form };
};

test("autocomplete tokens drop sections, shipping and billing, contact and webauthn", () => {
  const { vaultTokens } = makePage();
  assert.equal(vaultTokens("section-login shipping username webauthn"), "username");
  assert.equal(vaultTokens("billing work email"), "email");
  assert.equal(vaultTokens("current-password webauthn"), "current-password");
  assert.equal(vaultTokens("ONE-TIME-CODE"), "one-time-code");
  assert.equal(vaultTokens(""), "");
});

test("the classifier reads autocomplete, types and name heuristics", () => {
  const { vaultClassify } = makePage();
  const base = { type: "text", autocomplete: "", hints: "", inputMode: "", pattern: "", maxLength: -1, passwordCount: 0, passwordIndex: -1, formContext: "", pageContext: "example.com/" };
  const cases = [
    [{ type: "email", autocomplete: "username" }, "username"],
    [{ autocomplete: "section-signin billing username webauthn" }, "username"],
    [{ type: "password", autocomplete: "current-password", passwordCount: 1, passwordIndex: 0 }, "password"],
    [{ type: "password", autocomplete: "new-password", passwordCount: 1, passwordIndex: 0 }, "newPassword"],
    [{ autocomplete: "one-time-code" }, "otp"],
    [{ inputMode: "numeric", maxLength: 6, hints: "verification" }, "otp"],
    [{ hints: "totp" }, "otp"],
    [{ hints: "mfa_code" }, "otp"],
    [{ hints: "mfaCode" }, "otp"],
    [{ hints: "twoFactorToken", inputMode: "numeric" }, "otp"],
    [{ hints: "user_login" }, "username"],
    [{ type: "tel", hints: "code", maxLength: 6 }, "otp"],
    [{ inputMode: "numeric", maxLength: 6, hints: "pin", formContext: "two-step" }, "otp"],
    [{ hints: "promo code", maxLength: 6 }, null],
    [{ hints: "postal code", inputMode: "numeric", maxLength: 6 }, null],
    [{ hints: "code" }, null],
    [{ splitRun: true, maxLength: 1 }, "otp"],
    [{ type: "email", hints: "email", formContext: "newsletter", pageContext: "example.com/blog" }, null],
    [{ type: "email", hints: "identifier email", pageContext: "accounts.google.com/v3/signin/identifier" }, "username"],
    [{ type: "email", hints: "loginfmt i0116 enter your email, phone, or skype.", pageContext: "login.microsoftonline.com/common/oauth2/authorize" }, "username"],
    [{ hints: "account_name_text_field", pageContext: "idmsa.apple.com/appleauth/auth/signin" }, "username"],
    [{ hints: "username" }, "username"],
    [{ hints: "", precedesPassword: true, passwordCount: 1 }, "username"],
    [{ hints: "first name", passwordCount: 1 }, null],
    [{ type: "search", hints: "username" }, null],
    [{ autocomplete: "given-name", hints: "user" }, null],
    [{ type: "checkbox", hints: "remember username" }, null],
    [{ type: "url", hints: "website" }, null],
    [{ type: "email", hints: "email", passwordCount: 1 }, "username"],
    [{ type: "password", hints: "password", passwordCount: 1, passwordIndex: 0, formContext: "sign in" }, "password"],
    [{ type: "password", hints: "password", passwordCount: 1, passwordIndex: 0, formContext: "create account" }, "newPassword"],
    [{ type: "password", hints: "confirm password", passwordCount: 1, passwordIndex: 0 }, "newPassword"],
    [{ type: "password", hints: "password", passwordCount: 2, passwordIndex: 0, otherPasswordFresh: false }, "newPassword"],
    [{ type: "password", hints: "password", passwordCount: 2, passwordIndex: 0, otherPasswordFresh: true }, "password"],
    [{ type: "password", hints: "current password", passwordCount: 2, passwordIndex: 0 }, "password"],
    [{ type: "password", hints: "password", passwordCount: 3, passwordIndex: 0 }, "password"],
    [{ type: "password", hints: "password", passwordCount: 3, passwordIndex: 2 }, "newPassword"],
    [{ type: "password", hints: "otp", passwordCount: 1, passwordIndex: 0 }, "otp"],
  ];
  for (const [d, kind] of cases) assert.equal(vaultClassify({ ...base, ...d }), kind, JSON.stringify(d));
});

test("focusing a login field reports it with a top-frame rect, and blur reports focused false", () => {
  const page = makePage();
  const { user } = loginForm(page);
  page.fire(user, "focusin");
  page.fire(user, "focusout");
  assert.deepEqual(page.of("vaultField"), [
    { kind: "username", focused: true, rect: { x: 10, y: 20, width: 200, height: 30 }, formHasPassword: true, autocomplete: "username", maxLength: 0, email: true, clicked: false },
    { kind: "username", focused: false, rect: null, formHasPassword: true, autocomplete: "username", maxLength: 0, email: true, clicked: false },
  ]);
});

test("subframes send no rect, and a first-step username field says the form has no password", () => {
  const page = makePage({ top: false, origin: "https://accounts.google.com", path: "/v3/signin/identifier" });
  const user = page.input({ type: "email", name: "identifier", id: "identifierId" });
  page.body.append(page.el("form", {}, user, new page.FakeButton({ type: "button", text: "Next" })));
  page.fire(user, "focusin");
  assert.deepEqual(page.of("vaultField"), [{ kind: "username", focused: true, rect: null, formHasPassword: false, autocomplete: "", maxLength: 0, email: true, clicked: false }]);
});

test("hidden, disabled, readonly, tiny, aria-hidden and search fields are ignored", () => {
  const page = makePage();
  const hidden = page.input({ type: "password", name: "password" });
  hidden.style.display = "none";
  const disabled = page.input({ type: "password", name: "password", disabled: "" });
  const readonly = page.input({ type: "text", name: "username", readonly: "" });
  const tiny = page.input({ type: "text", name: "username" });
  tiny.rect = { left: 0, top: 0, width: 4, height: 4 };
  const covered = page.input({ type: "text", name: "username" });
  const search = page.input({ type: "text", name: "username" });
  page.body.append(page.el("div", { "aria-hidden": "true" }, covered), page.el("div", { role: "search" }, search), page.el("form", {}, hidden, disabled, readonly, tiny));
  for (const field of [hidden, disabled, readonly, tiny, covered, search]) page.fire(field, "focusin");
  assert.deepEqual(page.of("vaultField"), []);
});

test("scroll and resize resend the rect at most once per animation frame while focused", () => {
  const page = makePage();
  const { user } = loginForm(page);
  page.fire(user, "focusin");
  const scrolls = page.of("vaultField").length;
  user.rect = { left: 10, top: 5, width: 200, height: 30 };
  page.fire(page.body, "scroll");
  page.fire(page.body, "scroll");
  page.fire(page.body, "resize");
  assert.equal(page.frames.length, 1);
  page.frames.shift()();
  const reports = page.of("vaultField");
  assert.equal(reports.length, scrolls + 1);
  assert.deepEqual(reports.at(-1).rect, { x: 10, y: 5, width: 200, height: 30 });
});

test("a click on the focused field says so, so a dismissed menu can come back", () => {
  const page = makePage();
  const { user } = loginForm(page);
  page.fire(user, "focusin");
  page.fire(user, "mousedown");
  assert.deepEqual(page.of("vaultField").map((r) => r.clicked), [false, true]);
});

test("tabbing into a field counts as a click, but a focus long after Tab or from the page does not", () => {
  const page = makePage();
  const { user, pass } = loginForm(page);
  page.fire(page.body, "keydown", { key: "Tab" });
  page.fire(user, "focusin");
  page.fire(user, "focusout");
  page.advance(600);
  page.fire(page.body, "keydown", { key: "Tab", isTrusted: false });
  page.fire(pass, "focusin");
  page.fire(pass, "focusout");
  page.fire(page.body, "keydown", { key: "Tab", shiftKey: true });
  page.fire(user, "focusin");
  page.fire(user, "focusout");
  page.advance(600);
  page.fire(pass, "focusin");
  assert.deepEqual(page.of("vaultField").filter((r) => r.focused).map((r) => r.clicked), [true, false, true, false]);
});

test("a readonly field that the page unlocks on focus is picked up a frame later", () => {
  const page = makePage();
  const user = page.input({ type: "email", name: "email", autocomplete: "username", readonly: "" });
  const pass = page.input({ type: "password", name: "password", autocomplete: "current-password" });
  page.body.append(page.el("form", {}, user, pass));
  page.fire(user, "focusin");
  assert.deepEqual(page.of("vaultField"), []);
  delete user.attrs.readonly;
  assert.equal(page.frames.length, 1);
  page.frames.shift()();
  assert.equal(page.of("vaultField").at(-1)?.kind, "username");
});

test("while the menu is open the field's rect follows the page, and a removed field reports a blur", () => {
  const page = makePage();
  const { user } = loginForm(page);
  page.fire(user, "focusin");
  page.handlers.vaultMenu({ open: true, highlighted: false });
  const before = page.of("vaultField").length;
  page.frames.shift()();
  assert.equal(page.of("vaultField").length, before, "an unchanged rect sends nothing");
  user.rect = { left: 10, top: 64, width: 200, height: 30 };
  page.frames.shift()();
  assert.deepEqual(page.of("vaultField").at(-1).rect, { x: 10, y: 64, width: 200, height: 30 });
  user.parentNode.children.splice(user.parentNode.children.indexOf(user), 1);
  user.parentNode = null;
  page.frames.shift()();
  assert.equal(page.of("vaultField").at(-1).focused, false);
  assert.equal(page.frames.length, 0, "the watch stops once the field is gone");
});

test("typing in the field while the menu is open says Typed, not a dismissal, and gives Enter back to the page", () => {
  const page = makePage();
  const { user } = loginForm(page);
  page.fire(user, "focusin");
  page.handlers.vaultMenu({ open: true, highlighted: true });
  page.type(user, "j");
  assert.deepEqual(page.of("vaultKey"), [{ key: "Typed" }]);
  const enter = page.fire(user, "keydown", { key: "Enter" });
  assert.equal(enter.stopped ?? false, false, "Enter reaches the page");
});

test("a fill refuses a different origin and fills nothing", () => {
  const page = makePage();
  const { user, pass } = loginForm(page);
  page.fire(user, "focusin");
  page.handlers.vaultFill({ id: "f1", origin: "https://evil.example", username: "me", password: "secret" });
  assert.equal(user.value, "");
  assert.equal(pass.value, "");
  assert.deepEqual(page.of("vaultFilled"), [{ id: "f1", filled: [] }]);
});

test("a fill sets username and password through the native setter in the focused form only, then focuses submit", () => {
  const page = makePage();
  const other = loginForm(page, { id: "other" });
  const { user, pass, button } = loginForm(page);
  const hiddenUser = page.input({ type: "text", name: "username" });
  hiddenUser.style.visibility = "hidden";
  user.parentNode.append(hiddenUser);
  page.fire(pass, "focusin");
  page.handlers.vaultFill({ id: "f2", origin: "https://example.com", username: "me@example.com", password: "secret" });
  assert.equal(user.value, "me@example.com");
  assert.equal(pass.value, "secret");
  assert.equal(hiddenUser.value, "");
  assert.equal(other.user.value, "");
  assert.equal(other.pass.value, "");
  assert.deepEqual(user.dispatched, ["input", "change"]);
  assert.deepEqual(pass.dispatched, ["input", "change"]);
  assert.deepEqual(page.of("vaultFilled"), [{ id: "f2", filled: ["username", "password"] }]);
  assert.equal(page.focused.at(-1), button);
});

test("a generated password goes into every new-password field of the form", () => {
  const page = makePage({ path: "/signup" });
  const email = page.input({ type: "email", name: "email" });
  const first = page.input({ type: "password", name: "password" });
  const confirm = page.input({ type: "password", name: "password_confirmation" });
  page.body.append(page.el("form", { id: "signup" }, email, first, confirm, new page.FakeButton({ text: "Create account" })));
  page.fire(first, "focusin");
  assert.equal(page.of("vaultField")[0].kind, "newPassword");
  page.handlers.vaultFill({ id: "g", origin: "https://example.com", newPassword: "abcde-fghij-klmno-pqrs1" });
  assert.equal(first.value, "abcde-fghij-klmno-pqrs1");
  assert.equal(confirm.value, "abcde-fghij-klmno-pqrs1");
  assert.equal(email.value, "");
  assert.deepEqual(page.of("vaultFilled"), [{ id: "g", filled: ["newPassword"] }]);
});

test("a one-time code spreads over a run of single-character inputs", () => {
  const page = makePage({ path: "/verify" });
  const boxes = Array.from({ length: 6 }, (_, i) => page.input({ type: "text", maxlength: "1", inputmode: "numeric", name: `d${i}` }));
  page.body.append(page.el("form", {}, page.el("div", {}, ...boxes)));
  page.fire(boxes[2], "focusin");
  assert.equal(page.of("vaultField")[0].kind, "otp");
  page.handlers.vaultFill({ id: "o", origin: "https://example.com", otp: "482913" });
  assert.deepEqual(page.of("vaultFilled"), [], "the reply waits until every box has its digit");
  page.advance(10);
  assert.deepEqual(
    boxes.map((b) => b.value),
    ["4", "8", "2", "9", "1", "3"],
  );
  assert.deepEqual(page.of("vaultFilled"), [{ id: "o", filled: ["otp"] }]);
});

const fillCode = (page, field, code = "482913") => {
  page.fire(field, "focusin");
  const reported = page.of("vaultField").at(-1);
  page.handlers.vaultFill({ id: "c", origin: page.location.origin, otp: code });
  page.advance(10);
  return { kind: reported && reported.kind, filled: page.of("vaultFilled").at(-1) };
};

test("realistic code pages take the code: one-time-code, a labelled numeric field, and a code page on its own subdomain", () => {
  const plain = makePage({ origin: "https://auth.example.com", path: "/mfa" });
  const code = plain.input({ type: "text", name: "code", autocomplete: "one-time-code", inputmode: "numeric", maxlength: "6" });
  plain.body.append(plain.el("form", { action: "/mfa/verify" }, code, plain.input({ type: "checkbox", name: "remember" }), new plain.FakeButton({ text: "Verify" })));
  assert.deepEqual(fillCode(plain, code), { kind: "otp", filled: { id: "c", filled: ["otp"] } });
  assert.equal(code.value, "482913");
  const labelled = makePage({ origin: "https://secure.example.org", path: "/two-step" });
  const field = labelled.input({ type: "text", inputmode: "numeric", maxlength: "6", "aria-label": "Verification code" });
  labelled.body.append(labelled.el("div", {}, labelled.el("div", {}, field), new labelled.FakeButton({ text: "Continue" })));
  assert.deepEqual(fillCode(labelled, field), { kind: "otp", filled: { id: "c", filled: ["otp"] } });
  assert.equal(field.value, "482913");
});

test("a code field whose placeholder goes away on focus still takes the code it was offered for", () => {
  const page = makePage({ path: "/account" });
  const field = page.input({ type: "text", inputmode: "numeric", maxlength: "6", placeholder: "Enter code" });
  page.body.append(page.el("form", {}, field, new page.FakeButton({ text: "Next" })));
  page.fire(field, "focusin");
  assert.equal(page.of("vaultField")[0].kind, "otp");
  delete field.attrs.placeholder;
  page.handlers.vaultFill({ id: "c", origin: "https://example.com", otp: "482913" });
  assert.equal(field.value, "482913");
  assert.deepEqual(page.of("vaultFilled"), [{ id: "c", filled: ["otp"] }]);
});

test("a six-box code that writes each keystroke into the focused box gets every digit in its own box", () => {
  const page = makePage({ path: "/verify" });
  const boxes = Array.from({ length: 6 }, (_, i) => page.input({ type: "tel", maxlength: "1", inputmode: "numeric", "aria-label": `Digit ${i + 1}` }));
  page.body.append(page.el("form", {}, page.el("div", { class: "otp" }, ...boxes.map((b) => page.el("div", {}, b))), new page.FakeButton({ text: "Verify" })));
  const digits = ["", "", "", "", "", ""];
  page.document.addEventListener("input", (e) => {
    const active = boxes.indexOf(page.focused.at(-1));
    if (!boxes.includes(e.target) || active < 0) return;
    digits[active] = e.target.value.slice(-1);
    boxes.forEach((b, i) => (b.value = digits[i]));
  });
  page.fire(boxes[2], "focusin");
  page.focused.push(boxes[2]);
  page.handlers.vaultFill({ id: "s", origin: "https://example.com", otp: "482913" });
  page.advance(10);
  assert.deepEqual(digits, ["4", "8", "2", "9", "1", "3"]);
  assert.deepEqual(page.of("vaultFilled"), [{ id: "s", filled: ["otp"] }]);
  assert.equal(page.focused.at(-1).textContent, "Verify", "focus ends on the submit button");
});

test("a split code stops if the page navigates away midway, and says nothing was filled", () => {
  const page = makePage({ path: "/verify" });
  const boxes = Array.from({ length: 6 }, () => page.input({ type: "text", maxlength: "1", inputmode: "numeric" }));
  page.body.append(page.el("form", {}, page.el("div", {}, ...boxes)));
  page.fire(boxes[0], "focusin");
  page.handlers.vaultFill({ id: "x", origin: "https://example.com", otp: "482913" });
  page.location.origin = "https://elsewhere.example";
  page.advance(10);
  assert.deepEqual(page.of("vaultFilled"), [{ id: "x", filled: [] }]);
  assert.ok(boxes.slice(1).every((b) => b.value === ""));
});

test("a generator chosen on a password field the page didn't mark as new fills that field and the confirmation after it", () => {
  const page = makePage({ path: "/account/password" });
  const email = page.input({ type: "email", name: "email" });
  const fresh = page.input({ type: "password", name: "password" });
  const confirm = page.input({ type: "password", name: "new_pw" });
  page.body.append(page.el("form", {}, email, fresh, confirm, new page.FakeButton({ text: "Save" })));
  page.fire(fresh, "focusin");
  assert.equal(page.of("vaultField")[0].kind, "password");
  page.handlers.vaultFill({ id: "g", origin: "https://example.com", newPassword: "abcde-fghij-klmno-pqrs1" });
  assert.deepEqual([email.value, fresh.value, confirm.value], ["", "abcde-fghij-klmno-pqrs1", "abcde-fghij-klmno-pqrs1"]);
  assert.deepEqual(page.of("vaultFilled"), [{ id: "g", filled: ["newPassword"] }]);
});

test("menu keys are taken only while the menu is open on the focused field, Enter only with a highlight, Tab passes, Escape closes", () => {
  const page = makePage();
  const { user, pass } = loginForm(page);
  page.fire(user, "focusin");
  const closed = page.fire(user, "keydown", { key: "ArrowDown" });
  assert.equal(closed.defaultPrevented, false);
  page.handlers.vaultMenu({ open: true });
  const elsewhere = page.fire(pass, "keydown", { key: "ArrowDown" });
  assert.equal(elsewhere.defaultPrevented, false);
  const down = page.fire(user, "keydown", { key: "ArrowDown" });
  assert.equal(down.defaultPrevented, true);
  page.handlers.vaultMenu({ open: true, highlighted: true });
  const enter = page.fire(user, "keydown", { key: "Enter" });
  assert.equal(enter.defaultPrevented, true);
  page.handlers.vaultMenu({ open: true, highlighted: false });
  const pageEnter = page.fire(user, "keydown", { key: "Enter" });
  assert.equal(pageEnter.defaultPrevented, false, "Enter with no highlighted row reaches the page");
  const closedAfterEnter = page.fire(user, "keydown", { key: "ArrowDown" });
  assert.equal(closedAfterEnter.defaultPrevented, false, "a passed Enter closes the menu in the page");
  page.handlers.vaultMenu({ open: true, highlighted: true });
  const untrusted = page.fire(user, "keydown", { key: "ArrowUp", isTrusted: false });
  assert.equal(untrusted.defaultPrevented, false);
  const escape = page.fire(user, "keydown", { key: "Escape" });
  assert.equal(escape.defaultPrevented, true);
  const after = page.fire(user, "keydown", { key: "ArrowDown" });
  assert.equal(after.defaultPrevented, false);
  page.handlers.vaultMenu({ open: true });
  const tab = page.fire(user, "keydown", { key: "Tab" });
  assert.equal(tab.defaultPrevented, false);
  assert.deepEqual(page.of("vaultKey"), [
    { key: "ArrowDown" },
    { key: "ArrowDown" },
    { key: "Enter" },
    { key: "Enter" },
    { key: "ArrowDown" },
    { key: "Escape" },
    { key: "ArrowDown" },
    { key: "Tab" },
  ]);
});

test("a change-password form keeps the current password apart from the new ones", () => {
  const page = makePage({ path: "/settings/password" });
  const current = page.input({ type: "password", name: "password" });
  const fresh = page.input({ type: "password", name: "new_password" });
  page.body.append(page.el("form", {}, current, fresh));
  page.fire(current, "focusin");
  page.fire(fresh, "focusin");
  assert.deepEqual(
    page.of("vaultField").filter((f) => f.focused).map((f) => f.kind),
    ["password", "newPassword"],
  );
});

test("a submitted login with a typed password is sent once, and an untyped one is not sent", () => {
  const page = makePage();
  const { user, pass, button, form } = loginForm(page);
  user.value = "page-set";
  pass.value = "page-set";
  page.fire(form, "submit");
  assert.deepEqual(page.of("vaultSubmit"), []);
  page.type(user, "me@example.com");
  page.type(pass, "hunter22");
  page.fire(button, "click");
  page.fire(form, "submit");
  assert.deepEqual(page.of("vaultSubmit"), [{ username: "me@example.com", password: "hunter22", newPassword: false, usernameFrom: "form", trusted: true }]);
});

test("a two-step login remembers the first step's username for the password step", () => {
  const page = makePage({ origin: "https://login.example.com", path: "/signin" });
  const user = page.input({ type: "email", name: "username" });
  const step = page.el("form", { id: "step1" }, user);
  page.body.append(step);
  page.type(user, "me@example.com");
  page.fire(user, "keydown", { key: "Enter" });
  step.remove();
  const pass = page.input({ type: "password", name: "password" });
  const second = page.el("form", { id: "step2" }, pass);
  page.body.append(second);
  page.type(pass, "s3cret!");
  page.fire(pass, "keydown", { key: "Enter" });
  assert.deepEqual(page.of("vaultSubmit"), [{ username: "me@example.com", password: "s3cret!", newPassword: false, usernameFrom: "step", trusted: true }]);
});

test("a sign-up submit reports newPassword and skips a mismatched confirmation", () => {
  const page = makePage({ path: "/register" });
  const email = page.input({ type: "email", name: "email" });
  const first = page.input({ type: "password", name: "password" });
  const confirm = page.input({ type: "password", name: "confirm" });
  const form = page.el("form", {}, email, first, confirm);
  page.body.append(form);
  page.type(email, "new@example.com");
  page.type(first, "abc12345");
  page.type(confirm, "abc1234");
  page.fire(form, "submit");
  assert.deepEqual(page.of("vaultSubmit"), []);
  page.type(confirm, "abc12345");
  page.fire(form, "submit");
  assert.deepEqual(page.of("vaultSubmit"), [{ username: "new@example.com", password: "abc12345", newPassword: true, usernameFrom: "form", trusted: false }]);
});

test("fields inside an open shadow root are classified through the composed path and filled", () => {
  const page = makePage();
  const host = page.el("login-box", {});
  const root = host.attachShadow({ mode: "open" });
  const user = page.input({ type: "text", name: "username" });
  const pass = page.input({ type: "password", name: "password" });
  root.append(page.el("div", {}, user, pass));
  page.body.append(page.el("div", {}, host));
  page.fire(user, "focusin", { target: host });
  assert.equal(page.of("vaultField")[0].kind, "username");
  page.handlers.vaultFill({ id: "s", origin: "https://example.com", username: "me", password: "pw" });
  assert.equal(user.value, "me");
  assert.equal(pass.value, "pw");
});

const ORIGIN = "https://example.com";
const keyEvents = (field) => field.events.filter((e) => e.type.startsWith("key"));
const styleOf = (style) => ({ values: { ...style }, priorities: { ...style.priorities } });
const EMPTY_STYLE = { values: {}, priorities: {} };

test("a fill without submit: true never submits, even once the frames have run", () => {
  const page = makePage();
  const { user, pass, button, form } = loginForm(page);
  page.fire(user, "focusin");
  page.handlers.vaultFill({ id: "row", origin: ORIGIN, username: "me@example.com", password: "pw-1" });
  page.handlers.vaultFill({ id: "row2", origin: ORIGIN, username: "me@example.com", password: "pw-1", submit: "true" });
  page.advance(1000);
  assert.equal(button.clicks ?? 0, 0);
  assert.equal(form.requested, 0);
  assert.deepEqual([...keyEvents(user), ...keyEvents(pass)], []);
  assert.deepEqual(page.of("vaultSubmit"), []);
});

test("a required empty field or an unchecked required checkbox stops the submit", () => {
  const blocked = (extra) => {
    const page = makePage();
    const { user, button, form } = loginForm(page);
    form.append(extra(page));
    page.fire(user, "focusin");
    page.handlers.vaultFill({ id: "t", origin: ORIGIN, username: "me@example.com", password: "pw-1", submit: true });
    page.advance(60);
    return button.clicks ?? 0;
  };
  assert.equal(blocked((p) => p.input({ type: "text", name: "captcha", required: "" })), 0);
  assert.equal(blocked((p) => p.input({ type: "text", name: "captcha", "aria-required": "true" })), 0);
  assert.equal(
    blocked((p) => {
      const terms = p.input({ type: "checkbox", name: "terms", required: "" });
      terms.style.opacity = "0";
      return terms;
    }),
    0,
  );
  assert.equal(blocked((p) => p.input({ type: "checkbox", name: "terms", required: "", checked: "" })), 1);
  assert.equal(blocked((p) => p.input({ type: "text", name: "optional" })), 1);
});

test("a fill that leaves a visible password empty does not submit, but a username-only step does", () => {
  const page = makePage();
  const { user, button } = loginForm(page);
  page.fire(user, "focusin");
  page.handlers.vaultFill({ id: "u", origin: ORIGIN, username: "me@example.com", submit: true });
  page.advance(60);
  assert.equal(button.clicks ?? 0, 0);

  const google = makePage({ origin: "https://accounts.google.com", path: "/v3/signin/identifier" });
  const email = google.input({ type: "email", name: "identifier", id: "identifierId" });
  const decoy = google.input({ type: "password", name: "hiddenPassword", "aria-hidden": "true" });
  const next = new google.FakeButton({ type: "button", text: "Next" });
  const step = google.el("form", {}, email, decoy, next);
  google.body.append(step);
  google.fire(email, "focusin");
  google.handlers.vaultFill({ id: "g1", origin: "https://accounts.google.com", username: "me@gmail.com", submit: true });
  google.advance(60);
  assert.equal(next.clicks, 1);
  step.remove();
  const pass = google.input({ type: "password", name: "Passwd" });
  const second = google.el("form", {}, pass);
  google.body.append(second);
  google.type(pass, "s3cret-pass");
  google.fire(second, "submit");
  assert.deepEqual(google.of("vaultSubmit"), [{ username: "me@gmail.com", password: "s3cret-pass", newPassword: false, usernameFrom: "step", trusted: false }]);
});

test("the submit fires 60 ms after the fill with no animation frame needed, and gives up if the origin changed or the form left the page", () => {
  const attempt = (spoil) => {
    const page = makePage();
    const { user, button, form } = loginForm(page);
    page.fire(user, "focusin");
    page.handlers.vaultFill({ id: "w", origin: ORIGIN, username: "me@example.com", password: "pw-1", submit: true });
    spoil(page, form);
    page.advance(59);
    const early = button.clicks ?? 0;
    page.advance(1);
    return [early, button.clicks ?? 0];
  };
  assert.deepEqual(
    attempt((page) => {
      page.location.origin = "https://other.example";
    }),
    [0, 0],
  );
  assert.deepEqual(
    attempt((page, form) => form.remove()),
    [0, 0],
  );
  assert.deepEqual(
    attempt(() => {}),
    [0, 1],
  );
});

test("a Touch ID fill clicks the visible sign-in button, skipping social and hidden ones, once per fill id", () => {
  const page = makePage();
  const user = page.input({ type: "email", name: "email", autocomplete: "username" });
  const pass = page.input({ type: "password", name: "password", autocomplete: "current-password" });
  const social = new page.FakeButton({ type: "button", text: "Continue with Google" });
  const hidden = new page.FakeButton({ text: "Log in" });
  hidden.style.display = "none";
  const disabled = new page.FakeButton({ text: "Log in", disabled: "" });
  const signIn = new page.FakeButton({ text: "Sign in" });
  const form = page.el("form", {}, user, pass, social, hidden, disabled, signIn);
  page.body.append(form);
  const secret = "correct-horse-9";
  page.fire(user, "focusin");
  page.handlers.vaultFill({ id: "f1", origin: ORIGIN, username: "me@example.com", password: secret, submit: true });
  page.advance(60);
  assert.deepEqual([social.clicks ?? 0, hidden.clicks ?? 0, disabled.clicks ?? 0, signIn.clicks ?? 0], [0, 0, 0, 1]);
  assert.equal(form.requested, 0);
  assert.deepEqual(page.of("vaultSubmit"), [{ username: "me@example.com", password: secret, newPassword: false, usernameFrom: "form", trusted: true }]);
  page.handlers.vaultFill({ id: "f1", origin: ORIGIN, username: "me@example.com", password: secret, submit: true });
  page.advance(60);
  assert.equal(signIn.clicks, 1, "the same fill id never submits twice");
  page.handlers.vaultFill({ id: "f2", origin: ORIGIN, username: "me@example.com", password: secret, submit: true });
  page.advance(60);
  assert.equal(signIn.clicks, 2);
  assert.deepEqual(
    page.sent.filter((m) => m.kind !== "vaultSubmit" && JSON.stringify(m.data).includes(secret)),
    [],
    "the password only leaves through vaultSubmit",
  );
});

test("with no usable button the form is sent with requestSubmit, or a submit event when requestSubmit is missing", () => {
  const page = makePage();
  const user = page.input({ type: "email", name: "email", autocomplete: "username" });
  const pass = page.input({ type: "password", name: "password", autocomplete: "current-password" });
  const form = page.el("form", { action: "/session" }, user, pass);
  page.body.append(form);
  page.fire(pass, "focusin");
  page.handlers.vaultFill({ id: "r", origin: ORIGIN, username: "me@example.com", password: "pw-1", submit: true });
  page.advance(60);
  assert.equal(form.requested, 1);
  assert.deepEqual(page.of("vaultSubmit"), [{ username: "me@example.com", password: "pw-1", newPassword: false, usernameFrom: "form", trusted: true }], "our submit and the page's submit event save once");

  const old = makePage({ requestSubmit: false });
  const u = old.input({ type: "email", name: "email", autocomplete: "username" });
  const p = old.input({ type: "password", name: "password", autocomplete: "current-password" });
  const f = old.el("form", {}, u, p);
  old.body.append(f);
  old.fire(p, "focusin");
  old.handlers.vaultFill({ id: "r", origin: ORIGIN, username: "me@example.com", password: "pw-1", submit: true });
  old.advance(60);
  const submits = f.events.filter((e) => e.type === "submit");
  assert.equal(submits.length, 1);
  assert.equal(submits[0].bubbles && submits[0].cancelable, true);
  assert.equal(old.of("vaultSubmit").length, 1);
});

test("with no form and no button the last filled field gets a full Enter key sequence", () => {
  const page = makePage();
  const user = page.input({ type: "email", name: "email", autocomplete: "username" });
  const pass = page.input({ type: "password", name: "password", autocomplete: "current-password" });
  page.body.append(page.el("div", { class: "login" }, user, pass));
  page.fire(user, "focusin");
  page.handlers.vaultFill({ id: "e", origin: ORIGIN, username: "me@example.com", password: "pw-1", submit: true });
  page.advance(60);
  assert.deepEqual(keyEvents(user), []);
  assert.deepEqual(
    keyEvents(pass).map((e) => [e.type, e.key, e.code, e.keyCode, e.which, e.charCode, e.bubbles]),
    [
      ["keydown", "Enter", "Enter", 13, 13, 0, true],
      ["keypress", "Enter", "Enter", 13, 13, 13, true],
      ["keyup", "Enter", "Enter", 13, 13, 0, true],
    ],
  );
  assert.deepEqual(page.of("vaultSubmit"), [{ username: "me@example.com", password: "pw-1", newPassword: false, usernameFrom: "form", trusted: true }]);

  const roles = makePage();
  const name = roles.input({ type: "text", name: "username" });
  const word = roles.input({ type: "password", name: "password" });
  const apple = roles.el("div", { role: "button", text: "Continue with Apple" });
  const next = roles.el("div", { role: "button", text: "Continue" });
  roles.body.append(roles.el("div", {}, name, word, apple, next));
  roles.fire(name, "focusin");
  roles.handlers.vaultFill({ id: "e", origin: ORIGIN, username: "me", password: "pw-1", submit: true });
  roles.advance(60);
  assert.deepEqual([apple.clicks ?? 0, next.clicks ?? 0], [0, 1]);
  assert.deepEqual(keyEvents(word), []);
});

test("filled fields are tinted, then every earlier inline style value comes back exactly", () => {
  const page = makePage();
  const { user, pass } = loginForm(page);
  user.style.setProperty("background-color", "rgb(1, 2, 3)", "important");
  user.style.setProperty("transition-duration", "2s");
  const before = styleOf(user.style);
  page.fire(user, "focusin");
  page.handlers.vaultFill({ id: "h", origin: ORIGIN, username: "me@example.com", password: "pw-1" });
  for (const field of [user, pass]) {
    assert.equal(field.style.backgroundColor, "rgba(250, 220, 90, 0.35)");
    assert.equal(field.style.getPropertyPriority("background-color"), "important");
    assert.equal(field.style.transitionProperty, "none");
  }
  page.advance(600);
  assert.equal(user.style.transitionProperty, "background-color");
  assert.equal(user.style.transitionDuration, "900ms");
  assert.equal(user.style.backgroundColor, "rgb(1, 2, 3)", "the fade runs back to the page's own value");
  assert.equal(pass.style.backgroundColor, undefined);
  page.advance(1000);
  assert.deepEqual(styleOf(user.style), before);
  assert.deepEqual(styleOf(pass.style), EMPTY_STYLE);
  assert.equal(page.clock.timers.length, 0);
});

test("dark-scheme pages get the softer tint", () => {
  const tintOn = (options) => {
    const page = makePage(options);
    const { user } = loginForm(page);
    page.fire(user, "focusin");
    page.handlers.vaultFill({ id: "d", origin: ORIGIN, username: "me@example.com" });
    return user.style.backgroundColor;
  };
  const dark = "(prefers-color-scheme: dark)";
  assert.equal(tintOn({ scheme: "normal", media: { [dark]: true } }), "rgba(250, 220, 90, 0.35)");
  assert.equal(tintOn({ scheme: "light dark" }), "rgba(250, 220, 90, 0.35)");
  assert.equal(tintOn({ scheme: "light dark", media: { [dark]: true } }), "rgba(250, 220, 90, 0.22)");
  assert.equal(tintOn({ scheme: "dark" }), "rgba(250, 220, 90, 0.22)");
});

test("typing in a tinted field restores it at once, and our own input events do not", () => {
  const page = makePage();
  const { user, pass } = loginForm(page);
  user.style.setProperty("transition-property", "opacity");
  const before = styleOf(user.style);
  page.fire(user, "focusin");
  page.handlers.vaultFill({ id: "t", origin: ORIGIN, username: "me@example.com", password: "pw-1" });
  assert.equal(user.style.backgroundColor, "rgba(250, 220, 90, 0.35)");
  user.dispatchEvent(new page.FakeEvent("input", { bubbles: true }));
  assert.equal(user.style.backgroundColor, "rgba(250, 220, 90, 0.35)", "a page-dispatched input is not the person typing");
  page.type(user, "me@example.co");
  assert.deepEqual(styleOf(user.style), before);
  assert.equal(pass.style.backgroundColor, "rgba(250, 220, 90, 0.35)");
  page.advance(3000);
  assert.deepEqual(styleOf(user.style), before);
  assert.deepEqual(styleOf(pass.style), EMPTY_STYLE);
});

test("with reduced motion the tint has no transition and goes after 900 ms", () => {
  const page = makePage({ media: { "(prefers-reduced-motion: reduce)": true } });
  const { user } = loginForm(page);
  page.fire(user, "focusin");
  page.handlers.vaultFill({ id: "m", origin: ORIGIN, username: "me@example.com" });
  page.advance(899);
  assert.equal(user.style.backgroundColor, "rgba(250, 220, 90, 0.35)");
  assert.equal(user.style.transitionDuration, undefined);
  page.advance(1);
  assert.deepEqual(styleOf(user.style), EMPTY_STYLE);
});

test("a background the page sets during the tint is left alone", () => {
  const page = makePage();
  const { user } = loginForm(page);
  page.fire(user, "focusin");
  page.handlers.vaultFill({ id: "p", origin: ORIGIN, username: "me@example.com" });
  user.style.setProperty("background-color", "red");
  page.advance(3000);
  assert.deepEqual(styleOf(user.style), { values: { backgroundColor: "red" }, priorities: {} });
});

test("emptying the focused field by hand says Cleared once per emptying, with the menu open or closed", () => {
  const page = makePage();
  const { user, pass } = loginForm(page);
  page.fire(pass, "focusin");
  page.type(user, "a");
  page.type(user, "");
  page.fire(pass, "focusout");
  page.fire(user, "focusin");
  page.type(user, "a", { isTrusted: false });
  page.type(user, "", { isTrusted: false });
  assert.deepEqual(page.of("vaultKey"), [], "untrusted input and other fields say nothing");
  page.type(user, "a");
  page.type(user, "");
  page.type(user, "");
  page.type(user, "b");
  page.type(user, "");
  page.type(user, "c");
  page.handlers.vaultMenu({ open: true });
  page.type(user, "");
  page.type(user, "d");
  assert.deepEqual(page.of("vaultKey"), [{ key: "Cleared" }, { key: "Cleared" }, { key: "Cleared" }, { key: "Typed" }]);
});

test("deleting a generated password, even with the menu open again, says Cleared and keeps the menu's keys", () => {
  const page = makePage({ path: "/signup" });
  const email = page.input({ type: "email", name: "email", value: "me@example.com" });
  const first = page.input({ type: "password", name: "password", autocomplete: "new-password" });
  const button = new page.FakeButton({ text: "Create account" });
  page.body.append(page.el("form", { id: "signup" }, email, first, button));
  page.fire(first, "focusin");
  page.handlers.vaultFill({ id: "g", origin: "https://example.com", newPassword: "abcde-fghij-klmno-pqrs1" });
  assert.equal(first.value, "abcde-fghij-klmno-pqrs1");
  page.fire(first, "focusout");
  page.fire(first, "focusin");
  page.handlers.vaultMenu({ open: true, highlighted: true });
  page.type(first, "");
  assert.deepEqual(page.of("vaultKey"), [{ key: "Cleared" }]);
  const enter = page.fire(first, "keydown", { key: "Enter" });
  assert.equal(enter.defaultPrevented, true, "the reopened menu still takes Return");
  assert.deepEqual(page.of("vaultKey").at(-1), { key: "Enter" });
});

test("ArrowDown in the focused field with the menu closed asks for the menu and stays with the page", () => {
  const page = makePage();
  const { user } = loginForm(page);
  const search = page.input({ type: "search", name: "q" });
  page.body.append(search);
  page.fire(search, "focusin");
  page.fire(search, "keydown", { key: "ArrowDown" });
  page.fire(user, "focusin");
  for (const modifier of ["altKey", "ctrlKey", "metaKey", "shiftKey"]) page.fire(user, "keydown", { key: "ArrowDown", [modifier]: true });
  page.fire(user, "keydown", { key: "ArrowDown", isTrusted: false });
  page.fire(user, "keydown", { key: "ArrowUp" });
  assert.deepEqual(page.of("vaultKey"), []);
  const down = page.fire(user, "keydown", { key: "ArrowDown" });
  assert.equal(down.defaultPrevented, false);
  assert.deepEqual(page.of("vaultKey"), [{ key: "ArrowDown" }]);
});

test("a menu open that arrives before the focus event adopts the field that is still focused", () => {
  const page = makePage();
  const { user } = loginForm(page);
  page.fire(user, "focusin");
  page.fire(user, "focusout");
  page.handlers.vaultMenu({ open: true });
  assert.equal(page.of("vaultField").at(-1).focused, false, "an open for a field that lost focus is answered with a blur");
  const away = page.fire(user, "keydown", { key: "ArrowUp" });
  assert.equal(away.defaultPrevented, false);
  focusState.el = user;
  page.handlers.vaultMenu({ open: true, highlighted: false });
  assert.equal(page.of("vaultField").at(-1).focused, true);
  const down = page.fire(user, "keydown", { key: "ArrowDown" });
  assert.equal(down.defaultPrevented, true);
});

test("a repeated focusin, a click on an untracked focused field and a back-forward restore all report the field again", () => {
  const page = makePage();
  const { user } = loginForm(page);
  page.fire(user, "focusin");
  page.fire(user, "focusin");
  assert.deepEqual(page.of("vaultField").map((f) => f.focused), [true, true]);
  page.handlers.vaultMenu({ open: true });
  page.fire(page.win, "pagehide");
  page.fire(page.win, "pageshow", { persisted: false });
  assert.deepEqual(page.of("vaultField").map((f) => f.focused), [true, true, false]);
  page.fire(user, "mousedown");
  assert.deepEqual(page.of("vaultField").at(-1), { ...page.of("vaultField")[0], clicked: true });
  page.fire(page.win, "pagehide");
  page.fire(page.win, "pageshow", { persisted: true });
  assert.deepEqual(page.of("vaultField").slice(-2).map((f) => f.focused), [false, true]);
  const down = page.fire(user, "keydown", { key: "ArrowDown" });
  assert.equal(down.defaultPrevented, false, "a restored page starts with the menu closed");
});

test("a username field says whether it takes an email, other fields never do", () => {
  const page = makePage({ path: "/signup" });
  const email = page.input({ type: "email", name: "email" });
  const handle = page.input({ type: "text", name: "username", autocomplete: "username" });
  const pass = page.input({ type: "password", name: "password", autocomplete: "new-password" });
  page.body.append(page.el("form", {}, email, handle, pass));
  for (const el of [email, handle, pass]) page.fire(el, "focusin");
  assert.deepEqual(page.of("vaultField").filter((f) => f.focused).map((f) => [f.kind, f.email]), [["username", true], ["username", false], ["newPassword", false]]);
});

test("every field report carries maxLength, 0 when the field has none", () => {
  const page = makePage({ path: "/verify" });
  const code = page.input({ type: "text", name: "otp", autocomplete: "one-time-code", maxlength: "6" });
  const user = page.input({ type: "email", name: "email", autocomplete: "username", maxlength: "0" });
  const pass = page.input({ type: "password", name: "password" });
  page.body.append(page.el("form", {}, code), page.el("form", {}, user, pass));
  page.fire(code, "focusin");
  page.fire(user, "focusin");
  page.fire(pass, "focusin");
  assert.deepEqual(page.of("vaultField").map((f) => [f.kind, f.focused, f.maxLength]), [
    ["otp", true, 6],
    ["otp", false, 6],
    ["username", true, 0],
    ["username", false, 0],
    ["password", true, 0],
  ]);
});

test("a password field, a mailto link, a placeholder address, a sentence and text four levels up never become the username", () => {
  const page = makePage({ path: "/session/password" });
  const pass = page.input({ type: "password", name: "password" });
  const form = page.el("form", {}, pass);
  const misnamed = page.input({ type: "password", autocomplete: "username", value: "hunter-22" });
  const level1 = page.el("div", {}, page.el("a", { href: "mailto:help@site.org", text: "help@site.org" }), form);
  const level2 = page.el("div", {}, page.el("p", { text: "name@example.com" }), level1);
  const level3 = page.el("div", {}, page.el("p", { text: "Signed in as me@site.org" }), misnamed, level2);
  const level4 = page.el("div", {}, page.el("span", { text: "far@site.org" }), level3);
  page.body.append(level4);
  page.type(pass, "s3cret-pass");
  page.fire(form, "submit");
  assert.deepEqual(page.of("vaultSubmit"), [{ username: "", password: "s3cret-pass", newPassword: false, usernameFrom: "", trusted: false }]);
});

test("a hidden autocomplete=username input names the account on a change-password page, and the new password is saved", () => {
  for (const variant of ["hidden-type", "display-none"]) {
    const page = makePage({ path: "/settings/password" });
    const account =
      variant === "hidden-type"
        ? page.input({ type: "hidden", autocomplete: "username", value: "me@site.org" })
        : page.input({ type: "text", autocomplete: "section-a username", value: "me@site.org" });
    if (variant === "display-none") account.style.display = "none";
    const current = page.input({ type: "password", name: "current_password", autocomplete: "current-password" });
    const fresh = page.input({ type: "password", name: "new_password", autocomplete: "new-password" });
    const confirm = page.input({ type: "password", name: "confirm_password", autocomplete: "new-password" });
    const form = page.el("form", {}, current, fresh, confirm, new page.FakeButton({ text: "Save" }));
    page.body.append(page.el("div", {}, account), form);
    page.type(current, "old-pass-1");
    page.type(fresh, "new-pass-2");
    page.type(confirm, "new-pass-2");
    page.fire(form, "submit");
    assert.deepEqual(page.of("vaultSubmit"), [{ username: "me@site.org", password: "new-pass-2", newPassword: true, usernameFrom: "page", trusted: false }], variant);
  }
});

test("a visible email field elsewhere names the account, but a hidden one without autocomplete does not", () => {
  const submitWith = (hide) => {
    const page = makePage({ path: "/reauth" });
    const header = page.input({ type: "email", name: "account", value: "me@site.org" });
    if (hide) header.style.display = "none";
    const pass = page.input({ type: "password", name: "password" });
    const form = page.el("form", {}, pass);
    page.body.append(page.el("header", {}, header), page.el("main", {}, page.el("section", {}, page.el("div", {}, page.el("div", {}, form)))));
    page.type(pass, "s3cret-pass");
    page.fire(form, "submit");
    const [sent] = page.of("vaultSubmit");
    return [sent.username, sent.usernameFrom];
  };
  assert.deepEqual(submitWith(true), ["", ""]);
  assert.deepEqual(submitWith(false), ["me@site.org", "page"]);
});

test("the earlier step's username beats page text, but only for ten minutes", () => {
  const page = makePage({ origin: "https://login.example.com", path: "/signin" });
  const user = page.input({ type: "email", name: "username" });
  const step = page.el("form", { id: "step1" }, user);
  page.body.append(step);
  page.type(user, "me@site.org");
  page.fire(user, "keydown", { key: "Enter" });
  step.remove();
  const pass = page.input({ type: "password", name: "password" });
  const second = page.el("form", { id: "step2" }, pass);
  page.body.append(page.el("div", {}, page.el("div", { text: "shown@site.org" }), second));
  page.type(pass, "s3cret-pass");
  page.fire(second, "submit");
  page.advance(600001);
  page.type(pass, "other-pass-1");
  page.fire(second, "submit");
  assert.deepEqual(page.of("vaultSubmit").map((s) => [s.username, s.usernameFrom]), [["me@site.org", "step"], ["shown@site.org", "nearby"]]);
});

test("an email address shown near the password step names the account, the closest one first", () => {
  const page = makePage({ origin: "https://accounts.google.com", path: "/v3/signin/challenge/pwd" });
  const pass = page.input({ type: "password", name: "Passwd" });
  const form = page.el("form", {}, pass);
  const inner = page.el("div", {}, page.el("div", {}, page.el("span", { text: "  me@gmail.com\n" })), form);
  page.body.append(page.el("div", {}, page.el("div", { text: "far@gmail.com" }), inner));
  page.type(pass, "s3cret-pass");
  page.fire(form, "submit");
  assert.deepEqual(page.of("vaultSubmit"), [{ username: "me@gmail.com", password: "s3cret-pass", newPassword: false, usernameFrom: "nearby", trusted: false }]);
});

test("a submit is trusted only after a real click or Enter within a second, never when the page submits on its own", () => {
  const page = makePage();
  const { user, pass, button, form } = loginForm(page);
  page.type(user, "me@example.com");
  page.type(pass, "hunter-22");
  page.fire(form, "submit");
  page.advance(2000);
  page.fire(form, "submit", { isTrusted: false });
  page.fire(page.body, "click");
  page.advance(1001);
  page.fire(form, "submit");
  page.advance(2000);
  page.fire(page.body, "click");
  page.advance(500);
  page.fire(form, "submit");
  page.advance(2000);
  page.fire(user, "keydown", { key: "Enter" });
  page.advance(2000);
  page.fire(form, "submit");
  page.fire(button, "click", { isTrusted: false });
  page.fire(button, "click");
  assert.deepEqual(page.of("vaultSubmit").map((s) => s.trusted), [false, false, false, true, true, false, true]);
});

test("the picker skips a header search button before a formless login and takes the nearest control after it", () => {
  const build = (withSignIn) => {
    const page = makePage();
    const search = page.input({ type: "search", name: "q" });
    const go = new page.FakeButton({ type: "button", text: "Go" });
    const user = page.input({ type: "email", name: "email", autocomplete: "username" });
    const pass = page.input({ type: "password", name: "password", autocomplete: "current-password" });
    const create = new page.FakeButton({ type: "button", text: "Create account" });
    const signIn = new page.FakeButton({ type: "button", text: "Sign in" });
    const later = new page.FakeButton({ type: "button", text: "Continue" });
    const tail = withSignIn ? [create, signIn, later] : [create];
    page.body.append(page.el("div", { id: "app" }, page.el("header", {}, search, go), page.el("section", {}, user), page.el("section", {}, pass, ...tail)));
    page.fire(user, "focusin");
    page.handlers.vaultFill({ id: "p", origin: ORIGIN, username: "me@example.com", password: "pw-1", submit: true });
    page.advance(60);
    return { go, create, signIn, later, pass };
  };
  const bare = build(false);
  assert.deepEqual([bare.go.clicks ?? 0, bare.create.clicks ?? 0], [0, 0]);
  assert.deepEqual(keyEvents(bare.pass).map((e) => e.type), ["keydown", "keypress", "keyup"]);
  const full = build(true);
  assert.deepEqual([full.go.clicks ?? 0, full.create.clicks ?? 0, full.signIn.clicks ?? 0, full.later.clicks ?? 0], [0, 0, 1, 0]);
});

test("a login fill clicks Sign in over a Create account submit next to it, and a new-password fill may click Create account", () => {
  const page = makePage();
  const user = page.input({ type: "email", name: "email", autocomplete: "username" });
  const pass = page.input({ type: "password", name: "password", autocomplete: "current-password" });
  const create = new page.FakeButton({ text: "Create account" });
  const signIn = new page.FakeButton({ text: "Sign in" });
  page.body.append(page.el("form", {}, user, pass, create, signIn));
  page.fire(user, "focusin");
  page.handlers.vaultFill({ id: "l", origin: ORIGIN, username: "me@example.com", password: "pw-1", submit: true });
  page.advance(60);
  assert.deepEqual([create.clicks ?? 0, signIn.clicks ?? 0], [0, 1]);

  const signup = makePage({ path: "/join" });
  const email = signup.input({ type: "email", name: "email", value: "new@site.org" });
  const fresh = signup.input({ type: "password", name: "password", autocomplete: "new-password" });
  const make = new signup.FakeButton({ text: "Create account" });
  signup.body.append(signup.el("form", {}, email, fresh, make));
  signup.fire(fresh, "focusin");
  signup.handlers.vaultFill({ id: "n", origin: ORIGIN, newPassword: "abcde-fghij-klmno-pqrs1", submit: true });
  signup.advance(60);
  assert.equal(make.clicks, 1);
});

test("the vault block never writes into the DOM or logs", () => {
  assert.doesNotMatch(vaultBlock, /innerHTML|insertAdjacent|appendChild|textContent\s*=(?!=)|console\./);
  assert.doesNotMatch(vaultBlock, /\.style\.[a-zA-Z]+\s*=(?!=)|\.cssText/, "inline styles change only through the captured CSSStyleDeclaration methods");
});

test("right-clicking a plain input that isn't a login field reports it and a context fill writes one value into that input only", () => {
  const page = makePage({ path: "/profile" });
  const nickname = page.input({ type: "text", name: "nickname" });
  const city = page.input({ type: "text", name: "city" });
  page.body.append(page.el("form", { id: "profile" }, nickname, city, new page.FakeButton({ text: "Save" })));
  page.fire(nickname, "contextmenu");
  assert.deepEqual(page.of("vaultContext"), [{ field: true, kind: null, guess: "username", rect: { x: 10, y: 20, width: 200, height: 30 }, maxLength: 0 }]);
  assert.deepEqual(page.of("vaultField"), []);
  page.handlers.vaultFill({ id: "c1", origin: "https://example.com", username: "octo", context: true });
  assert.equal(nickname.value, "octo");
  assert.equal(city.value, "");
  assert.deepEqual(nickname.dispatched, ["input", "change"]);
  assert.deepEqual(page.of("vaultFilled"), [{ id: "c1", filled: ["username"] }]);
  assert.deepEqual(page.focused, [], "a context fill leaves focus where it is");
  page.handlers.vaultFill({ id: "c2", origin: "https://example.com", password: "secret", context: true });
  assert.equal(nickname.value, "secret", "the password goes into the right-clicked field too");
  assert.equal(city.value, "");
});

test("a context fill refuses another origin, a right-click off any input, and a field that left the page", () => {
  const page = makePage();
  const plain = page.input({ type: "text", name: "note" });
  const label = page.el("div", { text: "Note" });
  page.body.append(page.el("form", {}, label, plain));
  page.fire(plain, "contextmenu");
  page.handlers.vaultFill({ id: "x1", origin: "https://evil.example", username: "octo", context: true });
  assert.equal(plain.value, "");
  page.fire(label, "contextmenu");
  assert.deepEqual(page.of("vaultContext").at(-1), { field: false });
  page.handlers.vaultFill({ id: "x2", origin: "https://example.com", username: "octo", context: true });
  assert.equal(plain.value, "");
  page.fire(plain, "contextmenu");
  plain.remove();
  page.handlers.vaultFill({ id: "x3", origin: "https://example.com", username: "octo", context: true });
  assert.deepEqual(page.of("vaultFilled"), [
    { id: "x1", filled: [] },
    { id: "x2", filled: [] },
    { id: "x3", filled: [] },
  ]);
});

test("a context code fill spreads over the split boxes from the first box, whichever box was right-clicked", () => {
  const page = makePage({ path: "/verify" });
  const boxes = Array.from({ length: 6 }, (_, i) => page.input({ type: "text", maxlength: "1", name: `d${i}` }));
  page.body.append(page.el("form", {}, page.el("div", {}, ...boxes)));
  page.fire(boxes[3], "contextmenu");
  assert.equal(page.of("vaultContext")[0].field, true);
  page.handlers.vaultFill({ id: "o", origin: "https://example.com", otp: "482913", context: true });
  page.advance(10);
  assert.deepEqual(
    boxes.map((b) => b.value),
    ["4", "8", "2", "9", "1", "3"],
  );
  assert.deepEqual(page.of("vaultFilled"), [{ id: "o", filled: ["otp"] }]);
});

test("a context fill never submits, and a generated password goes into the right-clicked password field only", () => {
  const page = makePage({ path: "/signup" });
  const email = page.input({ type: "email", name: "email" });
  const first = page.input({ type: "password", name: "password" });
  const confirm = page.input({ type: "password", name: "password_confirmation" });
  const button = new page.FakeButton({ text: "Create account" });
  const form = page.el("form", { id: "signup" }, email, first, confirm, button);
  page.body.append(form);
  page.fire(confirm, "contextmenu");
  assert.equal(page.of("vaultContext")[0].guess, "password");
  page.handlers.vaultFill({ id: "g", origin: "https://example.com", newPassword: "abcde-fghij-klmno-pqrs1", context: true, submit: true });
  page.advance(100);
  assert.equal(confirm.value, "abcde-fghij-klmno-pqrs1");
  assert.equal(first.value, "");
  assert.equal(button.clicks ?? 0, 0);
  assert.equal(form.requested, 0);
  assert.deepEqual(page.of("vaultSubmit"), []);
  assert.deepEqual(page.of("vaultFilled"), [{ id: "g", filled: ["newPassword"] }]);
});

test("a context fill with a whole login fills the form around the right-clicked field", () => {
  const page = makePage();
  const other = loginForm(page, { id: "other" });
  const { user, pass } = loginForm(page);
  page.fire(user, "contextmenu");
  assert.equal(page.of("vaultContext")[0].kind, "username");
  page.handlers.vaultFill({ id: "w", origin: "https://example.com", username: "me@example.com", password: "secret", context: true, submit: true });
  page.advance(100);
  assert.equal(user.value, "me@example.com");
  assert.equal(pass.value, "secret");
  assert.equal(other.user.value, "");
  assert.deepEqual(page.of("vaultFilled"), [{ id: "w", filled: ["username", "password"] }]);
  assert.deepEqual(page.of("vaultSubmit"), [], "a right-click fill never submits");
  assert.equal(page.of("vaultContext").length, 1);
});

const codeTargets = (page) => page.of("vaultCodeTarget");

test("right-clicking an image reports its rect and the viewport so native can read a QR code there", () => {
  const page = makePage({ path: "/settings/2fa" });
  Object.assign(page.win, { innerWidth: 1280, innerHeight: 800 });
  const qr = page.el("img", { src: "data:image/png;base64,AAAA" });
  qr.rect = { left: 400, top: 300, width: 180, height: 180 };
  page.body.append(page.el("div", {}, qr));
  page.fire(qr, "contextmenu");
  assert.deepEqual(codeTargets(page), [{ image: true, rect: { x: 400, y: 300, width: 180, height: 180 }, viewport: { width: 1280, height: 800 } }]);
});

test("a canvas, an svg drawn from parts and an element painted with a background image count as images", () => {
  const page = makePage();
  Object.assign(page.win, { innerWidth: 1000, innerHeight: 700 });
  const canvas = page.el("canvas", {});
  const path = page.el("path", {});
  const svg = page.el("svg", {}, page.el("g", {}, path));
  svg.rect = { left: 50, top: 60, width: 120, height: 120 };
  const painted = page.el("div", {});
  painted.style.backgroundImage = "url(\"/qr.png\")";
  page.body.append(canvas, svg, painted);
  page.fire(canvas, "contextmenu");
  page.fire(path, "contextmenu");
  assert.deepEqual(codeTargets(page)[0].rect, { x: 10, y: 20, width: 200, height: 30 });
  assert.deepEqual(codeTargets(page)[1].rect, { x: 50, y: 60, width: 120, height: 120 }, "a click on a path reports the whole svg");
  page.fire(painted, "contextmenu");
  assert.equal(codeTargets(page).length, 3);
});

test("an image in a frame reports no rect, so native reads the whole page picture", () => {
  const page = makePage({ top: false });
  const qr = page.el("img", {});
  page.body.append(qr);
  page.fire(qr, "contextmenu");
  assert.deepEqual(codeTargets(page), [{ image: true, rect: null, viewport: null }]);
});

test("an otpauth link, a selected setup key and a read-only key field report the text, and other text reports nothing", () => {
  const page = makePage();
  const link = page.el("a", { href: "otpauth://totp/GitHub:octo?secret=JBSWY3DPEHPK3PXP&issuer=GitHub" }, page.el("span", { text: "Open in app" }));
  const words = page.el("p", { text: "Scan this code with your app" });
  const key = page.input({ type: "text", readonly: "", value: "JBSW Y3DP EHPK 3PXP" });
  page.body.append(link, words, key);
  page.fire(link.children[0], "contextmenu");
  assert.deepEqual(codeTargets(page).at(-1), { text: "otpauth://totp/GitHub:octo?secret=JBSWY3DPEHPK3PXP&issuer=GitHub", rect: { x: 10, y: 20, width: 200, height: 30 } });
  page.selection.text = "  jbsw y3dp ehpk 3pxp ";
  page.fire(words, "contextmenu");
  assert.equal(codeTargets(page).at(-1).text, "jbsw y3dp ehpk 3pxp");
  page.selection.text = "";
  page.fire(key, "contextmenu");
  assert.equal(codeTargets(page).at(-1).text, "JBSW Y3DP EHPK 3PXP");
  page.selection.text = "please scan this code with your app";
  page.fire(words, "contextmenu");
  assert.deepEqual(codeTargets(page).at(-1), {}, "plain words aren't a key");
  page.selection.text = "internationalization";
  page.fire(words, "contextmenu");
  assert.deepEqual(codeTargets(page).at(-1), {}, "one long lowercase word without digits isn't a key");
  page.selection.text = "";
  page.fire(words, "contextmenu");
  assert.deepEqual(codeTargets(page).at(-1), {});
});

test("an untrusted contextmenu reports nothing", () => {
  const page = makePage();
  const qr = page.el("img", {});
  page.body.append(qr);
  page.fire(qr, "contextmenu", { isTrusted: false });
  assert.deepEqual(codeTargets(page), []);
});
