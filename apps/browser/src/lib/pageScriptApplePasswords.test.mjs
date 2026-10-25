import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const script = readFileSync(new URL("../../../../packages/ardiacore/ios/page_script.js", import.meta.url), "utf8");
const start = script.indexOf("  const USERNAME_TOKEN = ");
const end = script.indexOf("  const installNotifications = () => {", start);
assert.ok(start > 0 && end > start, "page_script.js has the Apple Passwords block");
const source = `let revealedField = null;\n${script.slice(start, end)}
return { loginFieldKind, verificationSetupURL, reveal: (el) => (revealedField = el) };`;

function input(attrs = {}) {
  return {
    localName: "input",
    type: attrs.type ?? "text",
    name: attrs.name ?? "",
    id: attrs.id ?? "",
    disabled: !!attrs.disabled,
    readOnly: !!attrs.readOnly,
    hidden: false,
    value: attrs.value ?? "",
    form: null,
    parentElement: null,
    width: attrs.width ?? 240,
    ownToggle: !!attrs.ownToggle,
    getAttribute: (name) => attrs[name] ?? null,
    getBoundingClientRect() {
      return { width: this.width, height: 32 };
    },
  };
}

function group(kind, ...fields) {
  const scope = {
    querySelectorAll: (selector) => (selector === "input" ? fields : []),
    querySelector: (selector) => (selector === 'input[type="password"]' ? (fields.find((f) => f.type === "password") ?? null) : null),
    contains: (el) => fields.includes(el),
  };
  for (const field of fields) if (kind === "form") field.form = scope;
  else field.parentElement = scope;
  return scope;
}

function image(attrs = {}) {
  return {
    localName: attrs.localName ?? "img",
    complete: attrs.complete ?? true,
    naturalWidth: attrs.naturalWidth ?? 200,
    src: attrs.src ?? "https://site.example/qr.png",
    currentSrc: attrs.src ?? "https://site.example/qr.png",
    qr: attrs.qr,
    getBoundingClientRect: () => ({ width: attrs.width ?? 180, height: attrs.height ?? 180 }),
  };
}

const KEY_BOX = { left: 286, top: 47, size: 24, width: 34, color: "black" };

function frame({ barcodes = true } = {}) {
  const sent = [];
  const listeners = {};
  const buttons = [];
  const observers = [];
  const detected = [];
  let detectors = 0;
  const document = {
    activeElement: null,
    visibilityState: "visible",
    readyState: "complete",
    images: [],
    addEventListener: (type, fn) => (listeners[type] ??= []).push(fn),
    querySelectorAll: (selector) => (selector === "img, canvas" ? document.images : []),
    querySelector: (selector) => (selector === "input" ? {} : null),
    documentElement: { appendChild: (host) => (host.isConnected = true) },
  };
  class BarcodeDetector {
    constructor(options) {
      detectors++;
      assert.deepEqual(options, { formats: ["qr_code"] });
    }
    detect(el) {
      detected.push(el);
      if (el.qr instanceof Error) return Promise.reject(el.qr);
      return Promise.resolve(el.qr ? [{ rawValue: el.qr, format: "qr_code" }] : []);
    }
  }
  class MutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observing = false;
      observers.push(this);
    }
    observe() {
      this.observing = true;
    }
    disconnect() {
      this.observing = false;
    }
  }
  const fieldButton = (tag) => {
    const host = { tag, style: {}, isConnected: false };
    const button = { style: {}, attrs: {}, handlers: {}, setAttribute: (k, v) => (button.attrs[k] = v), addEventListener: (t, fn) => (button.handlers[t] = fn) };
    buttons.push({ host, button });
    return { host, button };
  };
  const handlers = Object.create(null);
  const typedByUser = new WeakSet();
  const names = [
    "document", "send", "guard", "later", "onReady", "handlers", "typedByUser", "hasOwnToggle", "placeTrailing", "trailingRect", "addListener", "apply", "showIcon", "ICON_ATTRIBUTES", "fieldButton",
    "barcodeDetector", "FrameMutationObserver", "setTimeout", "addEventListener", "requestAnimationFrame",
  ];
  const helpers = new Function(...names, source)(
    document,
    (kind, data) => sent.push({ kind, data }),
    (fn) => fn,
    (fn) => fn,
    (fn) => fn(),
    handlers,
    typedByUser,
    (el) => el.ownToggle,
    () => {},
    () => KEY_BOX,
    function (type, fn) {
      this.addEventListener(type, fn);
    },
    Reflect.apply,
    (button, shapes) => (button.icon = shapes),
    {},
    fieldButton,
    () => (barcodes ? BarcodeDetector : undefined),
    MutationObserver,
    (fn) => fn(),
    () => {},
    () => {},
  );
  const fire = (type, event) => {
    for (const fn of listeners[type] ?? []) fn(event);
  };
  const focus = (el) => {
    document.activeElement = el;
    fire("focusin", { target: el });
  };
  const type = (el, value, trusted = true) => {
    el.value = value;
    if (trusted && value && el.type === "password") typedByUser.add(el);
    fire("input", { target: el, isTrusted: trusted });
  };
  const key = () => buttons.find((b) => b.host.tag === "ardia-passwords");
  const keyShown = () => key()?.host.style.display === "block";
  const click = (trusted, timeStamp, at = { clientX: KEY_BOX.left + 17, clientY: KEY_BOX.top + 12 }) =>
    key().button.handlers.click({ isTrusted: trusted, timeStamp, ...at, preventDefault() {}, stopPropagation() {} });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    ...helpers, document, handlers, sent, listeners, observers, detected, focus, type, key, keyShown, click, settle, fire,
    get detectors() {
      return detectors;
    },
  };
}

test("login fields are classified by type, autocomplete and the form around them", () => {
  const { loginFieldKind } = frame();
  const password = input({ type: "password" });
  assert.equal(loginFieldKind(password, null), "password");

  const revealed = input({ type: "text", name: "pw" });
  assert.equal(loginFieldKind(revealed, revealed), "password");
  assert.equal(loginFieldKind(revealed, null), null);

  assert.equal(loginFieldKind(input({ autocomplete: "one-time-code", name: "otp" }), null), "code");
  assert.equal(loginFieldKind(input({ type: "email" }), null), "username");
  assert.equal(loginFieldKind(input({ autocomplete: "username webauthn" }), null), "username");
  assert.equal(loginFieldKind(input({ autocomplete: "off" }), null), null);

  const withPassword = input({ name: "login" });
  group("form", withPassword, input({ type: "password" }));
  assert.equal(loginFieldKind(withPassword, null), "username");

  const withoutPassword = input({ name: "login" });
  group("form", withoutPassword, input({ name: "remember" }));
  assert.equal(loginFieldKind(withoutPassword, null), null);

  const inContainer = input({ type: "tel", placeholder: "Account number" });
  group("container", inContainer, input({ type: "password" }));
  assert.equal(loginFieldKind(inContainer, null), "username");

  const besideRevealed = input({ id: "user" });
  const shownPassword = input({ type: "text", name: "pw" });
  group("form", besideRevealed, shownPassword);
  assert.equal(loginFieldKind(besideRevealed, null), null);
  assert.equal(loginFieldKind(besideRevealed, shownPassword), "username");

  const search = input({ name: "q", placeholder: "Search" });
  group("form", search, input({ type: "password" }));
  assert.equal(loginFieldKind(search, null), null);

  const number = input({ type: "number", name: "user" });
  group("form", number, input({ type: "password" }));
  assert.equal(loginFieldKind(number, null), null);
});

test("disabled, readonly, hidden and narrow fields get no key", () => {
  const { loginFieldKind } = frame();
  assert.equal(loginFieldKind(input({ type: "password", readOnly: true }), null), null);
  assert.equal(loginFieldKind(input({ type: "password", disabled: true }), null), null);
  assert.equal(loginFieldKind(input({ type: "hidden", autocomplete: "username" }), null), null);
  assert.equal(loginFieldKind(input({ type: "password", width: 79 }), null), null);
  assert.equal(loginFieldKind(input({ type: "password", width: 80 }), null), "password");
  assert.equal(loginFieldKind({ localName: "textarea", getAttribute: () => "username", getBoundingClientRect: () => ({ width: 300 }) }, null), null);
});

test("only otpauth setup links up to 2048 characters are accepted", () => {
  const { verificationSetupURL } = frame();
  const totp = "otpauth://totp/Site:me@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Site";
  assert.equal(verificationSetupURL(totp), totp);
  assert.equal(verificationSetupURL("otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8"), "otpauth-migration://offline?data=CjEKCkhlbGxvId6tvu8");
  assert.equal(verificationSetupURL("OTPAUTH://hotp/x?secret=AB"), "OTPAUTH://hotp/x?secret=AB");
  assert.equal(verificationSetupURL("https://site.example/?otpauth://totp"), null);
  assert.equal(verificationSetupURL("javascript:alert(1)//otpauth://totp"), null);
  assert.equal(verificationSetupURL("otpauth:totp/x?secret=AB"), null);
  assert.equal(verificationSetupURL(" otpauth://totp/x?secret=AB"), null);
  const prefix = "otpauth://totp/x?secret=";
  assert.equal(verificationSetupURL(prefix + "A".repeat(2048 - prefix.length)), prefix + "A".repeat(2048 - prefix.length));
  assert.equal(verificationSetupURL(prefix + "A".repeat(2049 - prefix.length)), null);
  assert.equal(verificationSetupURL(null), null);
});

test("with Apple mode off nothing listens, scans or shows", async () => {
  const page = frame();
  page.document.images = [image({ qr: "otpauth://totp/x?secret=AB" })];
  page.handlers.applePasswords(false);
  page.handlers.applePasswords("true");
  page.focus(input({ type: "password" }));
  await page.settle();
  assert.deepEqual(Object.keys(page.listeners), []);
  assert.equal(page.observers.length, 0);
  assert.equal(page.detectors, 0);
  assert.equal(page.key(), undefined);
  assert.deepEqual(page.sent, []);
});

test("the key asks for Passwords only on a trusted click, once per 600 ms", () => {
  const page = frame();
  page.handlers.applePasswords(true);
  const password = input({ type: "password" });
  page.focus(password);
  assert.equal(page.keyShown(), true);
  assert.equal(page.key().button.attrs["aria-label"], "Fill from Passwords");

  page.click(false, 1000);
  assert.deepEqual(page.sent, []);
  page.click(true, 1000);
  page.click(true, 1500);
  page.click(true, 1700);
  assert.deepEqual(page.sent, [
    { kind: "applePasswords", data: { field: "password" } },
    { kind: "applePasswords", data: { field: "password" } },
  ]);

  page.focus(input({ autocomplete: "one-time-code" }));
  page.click(true, 3000);
  assert.deepEqual(page.sent.at(-1), { kind: "applePasswords", data: { field: "code" } });
});

test("a trusted click that lands outside the key's own box, as when a page stretches the key over itself, asks for nothing", () => {
  const page = frame();
  page.handlers.applePasswords(true);
  page.focus(input({ type: "password" }));
  page.click(true, 1000, { clientX: 20, clientY: 20 });
  page.click(true, 2000, { clientX: KEY_BOX.left + KEY_BOX.width + 40, clientY: KEY_BOX.top + 5 });
  assert.deepEqual(page.sent, []);
  page.click(true, 3000);
  assert.deepEqual(page.sent, [{ kind: "applePasswords", data: { field: "password" } }]);
});

test("the key gives way once the user types, and comes back for filled-in values", () => {
  const page = frame();
  page.handlers.applePasswords(true);
  const password = input({ type: "password", value: "prefilled" });
  page.focus(password);
  assert.equal(page.keyShown(), true);
  page.type(password, "hunter2");
  assert.equal(page.keyShown(), false);
  page.type(password, "");
  assert.equal(page.keyShown(), true);

  const email = input({ type: "email" });
  page.focus(email);
  assert.equal(page.keyShown(), true);
  page.type(email, "me@example.com");
  assert.equal(page.keyShown(), false);
  page.type(email, "", true);
  page.type(email, "filled@example.com", false);
  assert.equal(page.keyShown(), true);

  page.focus(input({ type: "password", ownToggle: true }));
  assert.equal(page.keyShown(), false);
  page.focus(input({ name: "q" }));
  assert.equal(page.keyShown(), false);
});

test("turning Apple mode off hides the key and stops it sending", () => {
  const page = frame();
  page.handlers.applePasswords(true);
  page.focus(input({ type: "password" }));
  assert.equal(page.observers[0].observing, true);
  page.handlers.applePasswords(false);
  assert.equal(page.keyShown(), false);
  assert.equal(page.observers[0].observing, false);
  page.focus(input({ type: "password" }));
  assert.equal(page.keyShown(), false);
  page.click(true, 5000);
  assert.deepEqual(page.sent, []);
});

test("verification code setup QR codes are reported once per link", async () => {
  const page = frame();
  const totp = "otpauth://totp/Site:me?secret=JBSWY3DPEHPK3PXP";
  page.document.images = [
    image({ qr: totp }),
    image({ qr: totp, src: "https://site.example/again.png" }),
    image({ qr: "https://site.example/app", src: "https://site.example/link.png" }),
    image({ qr: new Error("SecurityError"), src: "https://other.example/qr.png" }),
    image({ localName: "canvas", qr: "otpauth-migration://offline?data=AB", src: "" }),
  ];
  page.handlers.applePasswords(true);
  await page.settle();
  assert.equal(page.detected.length, 5);
  assert.deepEqual(page.sent, [
    { kind: "verificationCodeSetup", data: { url: totp } },
    { kind: "verificationCodeSetup", data: { url: "otpauth-migration://offline?data=AB" } },
  ]);

  page.observers[0].callback();
  await page.settle();
  assert.equal(page.detected.length, 5);
  assert.equal(page.sent.length, 2);
});

test("QR scanning skips the wrong shapes, hidden pages, and stops after 12 detections", async () => {
  const page = frame();
  page.document.images = [
    image({ width: 63, height: 63 }),
    image({ width: 641, height: 641 }),
    image({ width: 200, height: 120 }),
    image({ naturalWidth: 32 }),
    image({ complete: false }),
    image({ localName: "video" }),
  ];
  page.handlers.applePasswords(true);
  await page.settle();
  assert.deepEqual(page.detected, []);

  page.document.visibilityState = "hidden";
  page.document.images = [image()];
  page.observers[0].callback();
  assert.deepEqual(page.detected, []);

  page.document.visibilityState = "visible";
  page.document.images = Array.from({ length: 20 }, (_, i) => image({ src: `https://site.example/${i}.png` }));
  page.observers[0].callback();
  page.document.images.push(image({ src: "https://site.example/late.png" }));
  page.observers[0].callback();
  assert.equal(page.detected.length, 12);
  assert.equal(page.detectors, 1);
});

test("without a native BarcodeDetector no observer is installed", () => {
  const page = frame({ barcodes: false });
  page.document.images = [image({ qr: "otpauth://totp/x?secret=AB" })];
  page.handlers.applePasswords(true);
  assert.equal(page.observers.length, 0);
  assert.deepEqual(page.sent, []);
});

test("the whole page script still compiles", () => {
  assert.doesNotThrow(() => new Function("post", `return ${script.trim().replace(/;\s*$/, "")}`));
});

test("clicking into an empty login field opens Passwords every time, but not for typed values, repeats or synthetic clicks", () => {
  const page = frame();
  page.handlers.applePasswords(true);
  const field = input({ type: "email" });
  const clickField = (trusted, timeStamp, target = field) => page.fire("click", { isTrusted: trusted, timeStamp, button: 0, target });
  page.focus(field);
  clickField(false, 1000);
  assert.deepEqual(page.sent, []);
  clickField(true, 1000);
  clickField(true, 1300);
  clickField(true, 2500);
  assert.deepEqual(page.sent, [
    { kind: "applePasswords", data: { field: "username", opened: "click" } },
    { kind: "applePasswords", data: { field: "username", opened: "click" } },
  ]);
  page.type(field, "me@example.com");
  clickField(true, 4000);
  assert.equal(page.sent.length, 2, "a value the person typed keeps the field theirs");
  page.focus(input({ type: "text", name: "search" }));
  clickField(true, 6000, page.document.activeElement);
  assert.equal(page.sent.length, 2, "other fields never open it");
});
