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
  const attrs = [...m[2].matchAll(/\[([a-z-]+)(?:="?([^"\]]*)"?)?\]/gi)].map((a) => [a[1], a[2]]);
  return (el) =>
    (!m[1] || m[1] === "*" || el.tagName === m[1].toUpperCase()) &&
    attrs.every(([name, value]) => (value === undefined ? el.getAttribute(name) !== null : el.getAttribute(name) === value));
};
const matcher = (selector) => {
  const parts = selector.split(",").map(simple);
  return (el) => parts.some((p) => p(el));
};

function makePage({ origin = "https://example.com", path = "/login", top = true } = {}) {
  const sent = [];
  const frames = [];
  const focused = [];
  class FakeTarget {
    constructor() {
      this.listeners = [];
      this.dispatched = [];
    }
    addEventListener(type, fn, options) {
      this.listeners.push({ type, fn, capture: options === true || !!(options && options.capture) });
    }
    dispatchEvent(e) {
      this.dispatched.push(e.type);
      return true;
    }
  }
  class FakeEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.bubbles = !!init.bubbles;
      this.composed = !!init.composed;
      this.defaultPrevented = false;
      this.stopped = false;
      this.isTrusted = false;
    }
    composedPath() {
      return this.path || [];
    }
    preventDefault() {
      this.defaultPrevented = true;
    }
    stopImmediatePropagation() {
      this.stopped = true;
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
      this.style = {};
      this.rect = { left: 10, top: 20, width: 200, height: 30 };
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
    focus() {
      focused.push(this);
    }
  }
  class FakeInput extends FakeHTMLElement {
    constructor(attrs = {}) {
      super("input", attrs);
      this.raw = attrs.value ?? "";
    }
    get value() {
      return this.raw;
    }
    set value(v) {
      this.raw = String(v);
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
  }
  class FakeFragment extends FakeNode {}
  class FakeDocument extends FakeNode {}
  const document = new FakeDocument();
  const body = new FakeHTMLElement("body");
  document.append(body);
  const win = new FakeTarget();
  win.getComputedStyle = (el) => ({ visibility: el.style.visibility || "visible", display: el.style.display || "block", opacity: el.style.opacity ?? "1" });
  win.requestAnimationFrame = (fn) => frames.push(fn);
  const handlers = Object.create(null);
  const context = {
    window: win,
    document,
    location: { origin, hostname: new URL(origin).hostname, pathname: path },
    HTMLInputElement: FakeInput,
    HTMLElement: FakeHTMLElement,
    Element: FakeElement,
    EventTarget: FakeTarget,
    Event: FakeEvent,
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
  const el = (tag, attrs, ...kids) => new FakeElement(tag, attrs).append(...kids);
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
    const event = new FakeEvent(type);
    Object.assign(event, { isTrusted: true, target, path: pathOf(target) }, extra);
    for (const t of [win, document]) for (const l of t.listeners) if (l.type === type && !event.stopped) l.fn(event);
    return event;
  };
  const type = (field, value) => {
    field.value = value;
    fire(field, "input");
  };
  const of = (kind) => sent.filter((m) => m.kind === kind).map((m) => m.data);
  return { ...exports, sent, of, frames, focused, document, body, input, el, fire, type, handlers, FakeButton, el2: el };
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
    { kind: "username", focused: true, rect: { x: 10, y: 20, width: 200, height: 30 }, formHasPassword: true, autocomplete: "username", clicked: false },
    { kind: "username", focused: false, rect: null, formHasPassword: true, autocomplete: "username", clicked: false },
  ]);
});

test("subframes send no rect, and a first-step username field says the form has no password", () => {
  const page = makePage({ top: false, origin: "https://accounts.google.com", path: "/v3/signin/identifier" });
  const user = page.input({ type: "email", name: "identifier", id: "identifierId" });
  page.body.append(page.el("form", {}, user, new page.FakeButton({ type: "button", text: "Next" })));
  page.fire(user, "focusin");
  assert.deepEqual(page.of("vaultField"), [{ kind: "username", focused: true, rect: null, formHasPassword: false, autocomplete: "", clicked: false }]);
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

test("typing in the field while the menu is open closes it and gives Enter back to the page", () => {
  const page = makePage();
  const { user } = loginForm(page);
  page.fire(user, "focusin");
  page.handlers.vaultMenu({ open: true, highlighted: true });
  page.type(user, "j");
  assert.deepEqual(page.of("vaultKey"), [{ key: "Escape" }]);
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
  assert.deepEqual(
    boxes.map((b) => b.value),
    ["4", "8", "2", "9", "1", "3"],
  );
  assert.deepEqual(page.of("vaultFilled"), [{ id: "o", filled: ["otp"] }]);
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
  assert.deepEqual(page.of("vaultKey"), [{ key: "ArrowDown" }, { key: "Enter" }, { key: "Enter" }, { key: "Escape" }, { key: "Tab" }]);
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
  assert.deepEqual(page.of("vaultSubmit"), [{ username: "me@example.com", password: "hunter22", newPassword: false }]);
});

test("a two-step login remembers the first step's username for the password step", () => {
  const page = makePage({ origin: "https://login.example.com", path: "/signin" });
  const user = page.input({ type: "email", name: "username" });
  const step = page.el("form", { id: "step1" }, user);
  page.body.append(step);
  page.type(user, "me@example.com");
  page.fire(user, "keydown", { key: "Enter" });
  const pass = page.input({ type: "password", name: "password" });
  const second = page.el("form", { id: "step2" }, pass);
  page.body.append(second);
  page.type(pass, "s3cret!");
  page.fire(second, "submit");
  assert.deepEqual(page.of("vaultSubmit"), [{ username: "me@example.com", password: "s3cret!", newPassword: false }]);
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
  assert.deepEqual(page.of("vaultSubmit"), [{ username: "new@example.com", password: "abc12345", newPassword: true }]);
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

test("the vault block never writes into the DOM or logs", () => {
  assert.doesNotMatch(vaultBlock, /innerHTML|insertAdjacent|appendChild|textContent\s*=(?!=)|console\./);
});
