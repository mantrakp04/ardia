import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { reachesNativeHostUnchecked, resolveHostModule } from "./hostModules.ts";
import { linuxShellMethod } from "./shellMethods.ts";
import { hostModuleName, requireNativeModule } from "./shims/expo-modules-core.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const nativeHost = read("../../../engine/ardiacore-linux/src/ardia/linux/ac_linux_host.cc");
const bootstrap = nativeHost.slice(nativeHost.indexOf("base::DictValue ShellHostView::Bootstrap() const {"), nativeHost.indexOf("void ShellHostView::LayoutOverlay()"));
const advertised = [...bootstrap.matchAll(/\.Append\("([A-Za-z]+\.[A-Za-z]+)"\)/g)].map((match) => match[1]);
const engineDir = new URL("../../../engine/ardiacore-linux/src/ardia/linux/", import.meta.url);
const routedNatively = new Set(readdirSync(engineDir).filter((file) => /\.(cc|h)$/.test(file)).flatMap((file) => [...readFileSync(new URL(file, engineDir), "utf8").matchAll(/"(Ardia[A-Za-z]+\.[A-Za-z]+)"/g)].map((match) => match[1])));

const SHELL_SOURCES = new URL("../../../packages/shell/src/", import.meta.url);
const shellSources = readdirSync(SHELL_SOURCES).filter((file) => /\.tsx?$/.test(file)).map((file) => readFileSync(new URL(file, SHELL_SOURCES), "utf8"));

function typeBody(source, type) {
  const start = source.indexOf(`export type ${type} = {`);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let end = open; end < source.length; end++) {
    if (source[end] === "{") depth++;
    if (source[end] === "}" && --depth === 0) return source.slice(open + 1, end);
  }
  return null;
}

function members(body) {
  const parts = [];
  let depth = 0;
  let current = "";
  let previous = "";
  for (const char of body) {
    if ("({<[".includes(char)) depth++;
    if (")}]".includes(char) || (char === ">" && previous !== "=")) depth--;
    previous = char;
    if (depth === 0 && (char === ";" || char === "\n")) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim().match(/^(\w+)\??\s*(\(|<|:)(.*)$/s)).filter(Boolean)
    .map(([, name, mark, rest]) => ({ name, method: mark !== ":" || /=>/.test(rest) }))
    .filter((member) => member.name !== "addListener");
}

function moduleMap(type) {
  const body = typeBody(readFileSync(new URL("nativeModules.ts", SHELL_SOURCES), "utf8"), type);
  assert.ok(body, `packages/shell/src/nativeModules.ts no longer declares ${type}`);
  return [...body.matchAll(/(\w+): (\w+);/g)].map(([, module, typeName]) => {
    const declared = shellSources.map((source) => typeBody(source, typeName)).find((found) => found !== null);
    assert.ok(declared !== undefined, `${typeName} for ${module} is not declared in packages/shell/src`);
    return { module, methods: members(declared).filter((member) => member.method).map((member) => member.name) };
  });
}

const REQUIRED = moduleMap("ShellNativeModules");
const linuxExposes = (module) => advertised.some((capability) => capability === module || capability.startsWith(`${module}.`));

const FORMERLY_TRACKED_IN_305 = [
  "ArdiaApp.updaterState", "ArdiaApp.checkForUpdates", "ArdiaApp.setAutomaticUpdateChecks", "ArdiaApp.setAutomaticUpdateDownloads",
  "ArdiaApp.setUpdateChannel", "ArdiaApp.setWindowActivity", "ArdiaApp.share", "ArdiaApp.shareVia", "ArdiaApp.isInDock", "ArdiaApp.addToDock",
  "ArdiaApp.appIcons", "ArdiaApp.appIcon", "ArdiaApp.setAppIcon", "ArdiaApp.notificationPermission", "ArdiaApp.requestNotificationPermission",
  "ArdiaApp.postNotification", "ArdiaApp.removeNotifications", "ArdiaApp.openNotificationSettings", "ArdiaApp.setScriptState",
  "ArdiaApp.replyToScript", "ArdiaApp.crashReports", "ArdiaSystem.menuShortcuts", "ArdiaSystem.recordShortcut", "ArdiaSystem.cancelRecording",
  "ArdiaKeychain.get", "ArdiaKeychain.set", "ArdiaKeychain.delete", "ArdiaDockSelection.iconTheme", "ArdiaInlineCompletion.complete",
  "ArdiaTranslate.userLanguages", "ArdiaTranslate.languageName", "ArdiaTranslate.detect", "ArdiaTranslate.status",
  "ArdiaTranslate.supportedLanguages", "ArdiaTranslate.prepare", "ArdiaTranslate.translate", "ArdiaTranslate.translateBlocks",
  "ArdiaApp.devCrash", "ArdiaApp.devClick", "ArdiaMagnifyArea.devMagnify", "ArdiaFileDrop.devDrag", "ArdiaFileDrop.devLastFileDrag",
];
const ANSWERED = {
  "ArdiaApp.updaterState": { available: false },
  "ArdiaApp.appIcons": [],
  "ArdiaApp.crashReports": [],
  "ArdiaApp.postNotification": null,
  "ArdiaApp.removeNotifications": undefined,
};
const SYSTEM_INFO = ["ArdiaApp.systemInfo"];
const ALLOWED_TO_REJECT = new Set(SYSTEM_INFO);

const linuxHost = () => ({
  bootstrap: { windowId: "main", profileId: "default", capabilities: [...advertised] },
  invoke: async (method) => { throw new Error(`Unsupported Linux host method: ${method}`); },
  call: async () => "null",
  onEvent: () => () => {},
});

const SHIM_SOURCES = ["./shims/shell.tsx", "./shims/shellBase.tsx", "./shortcutsRuntime.ts"].map(read).join("\n");
const fromShim = (method) => new RegExp(`export (?:const|function|async function) ${method}\\b|export \\{[^}]*\\b${method}\\b[^}]*\\}|(?:hostShellLocals|shellLocals|managedShell)[^\\n]*\\b${method}\\b|^  ${method}[:,]|method === "${method}"`, "m").test(SHIM_SOURCES);
const nativelyImplemented = (method) => nativeHost.includes(`method == "ArdiaShell.${method}"`);

function audit(modules = REQUIRED) {
  const host = linuxHost();
  const missing = [];
  const unchecked = [];
  for (const { module, methods } of modules) {
    for (const method of methods) {
      const target = hostModuleName(module, method);
      const resolved = resolveHostModule(host, target, method);
      const name = `${module}.${method}`;
      const routed = `${target}.${method}`;
      if (typeof resolved !== "function") missing.push(name);
      else if (target === "ArdiaShell" ? !nativelyImplemented(method) && !linuxShellMethod(method) && !fromShim(method) : reachesNativeHostUnchecked(resolved) && !advertised.includes(routed) && !routedNatively.has(routed) && !ALLOWED_TO_REJECT.has(routed)) unchecked.push(name);
    }
  }
  return { missing, unchecked };
}

test("the audited modules are read from packages/shell's native module map", () => {
  assert.deepEqual(REQUIRED.map(({ module }) => module).filter((module) => ["ArdiaShell", "ArdiaApp", "ArdiaSystem", "ArdiaGlassEffect"].includes(module)), ["ArdiaShell", "ArdiaApp", "ArdiaSystem", "ArdiaGlassEffect"]);
  for (const module of ["ArdiaCli", "ArdiaUserScripts"]) assert.ok(REQUIRED.some((found) => found.module === module), `${module} is a required module`);
  assert.deepEqual(REQUIRED.find(({ module }) => module === "ArdiaGlassEffect").methods, ["isLiquidGlass"]);
  const app = REQUIRED.filter(({ module }) => hostModuleName(module) === "ArdiaApp").flatMap(({ methods }) => methods);
  for (const method of ["updaterState", "isInDock", "devCrash"]) assert.ok(app.includes(method), method);
  const shell = REQUIRED.filter(({ module }) => hostModuleName(module) === "ArdiaShell").map(({ module }) => module);
  assert.deepEqual(shell.sort(), ["ArdiaAppWindows", "ArdiaDialogs", "ArdiaFocus", "ArdiaMenus", "ArdiaShell"]);
});

test("every shared native method resolves to a callable on Linux and reaches a Linux adapter, an advertised or routed native method, or the explicit allow-to-reject list", () => {
  assert.deepEqual(audit(), { missing: [], unchecked: [] });
});

test("a method added to a shared module type without a Linux path fails the audit", () => {
  const app = REQUIRED.find(({ module }) => module === "ArdiaApp");
  const shell = REQUIRED.find(({ module }) => module === "ArdiaShell");
  assert.deepEqual(audit([{ module: "ArdiaApp", methods: [...app.methods, "bogusAppMethod"] }, { module: "ArdiaShell", methods: [...shell.methods, "bogusShellMethod"] }]).unchecked, ["ArdiaApp.bogusAppMethod", "ArdiaShell.bogusShellMethod"]);
});

test("the allow-to-reject list names only methods that still reach the native host unadvertised", () => {
  const host = linuxHost();
  const declared = new Set(REQUIRED.flatMap(({ module, methods }) => methods.map((method) => `${module}.${method}`)));
  const stale = [...ALLOWED_TO_REJECT].filter((name) => {
    const [module, method] = name.split(".");
    return !declared.has(name) || !reachesNativeHostUnchecked(resolveHostModule(host, module, method)) || advertised.includes(name) || routedNatively.has(name);
  });
  assert.deepEqual(stale, []);
});

const olderEngine = (...missing) => {
  const host = linuxHost();
  host.bootstrap.capabilities = host.bootstrap.capabilities.filter((capability) => !missing.includes(capability));
  return host;
};

test("the Mac-only methods of #305 answer on Linux with a truthful value or ERR_UNAVAILABLE, never as an unsupported host method", async () => {
  const host = linuxHost();
  for (const name of FORMERLY_TRACKED_IN_305) {
    const [module, method] = name.split(".");
    const resolved = resolveHostModule(host, module, method);
    assert.equal(typeof resolved, "function", name);
    assert.equal(reachesNativeHostUnchecked(resolved), false, name);
    const outcome = await resolved().then((value) => ({ value }), (error) => ({ error }));
    if (Object.hasOwn(ANSWERED, name)) assert.deepEqual(outcome, { value: ANSWERED[name] }, name);
    else assert.equal(outcome.error?.code, "ERR_UNAVAILABLE", name);
  }
});

test("the ardia command and the user-scripts folder answer on Linux as the modules were absent before they became required", async () => {
  const host = linuxHost();
  assert.equal(linuxExposes("ArdiaCli"), false);
  assert.equal(linuxExposes("ArdiaUserScripts"), false);
  assert.equal(resolveHostModule(host, "ArdiaCli", "installedVersion")(), null);
  assert.equal((await resolveHostModule(host, "ArdiaCli", "install")().catch((error) => error)).code, "ERR_UNAVAILABLE");
  assert.equal(resolveHostModule(host, "ArdiaUserScripts", "watch")(true), undefined);
  assert.deepEqual(await resolveHostModule(host, "ArdiaUserScripts", "read")(), { state: "empty" });
  assert.equal(await resolveHostModule(host, "ArdiaUserScripts", "readStatus")(), null);
  assert.equal(await resolveHostModule(host, "ArdiaUserScripts", "writeStatus")("{}"), undefined);
});

test("an engine that advertises one of those methods is called instead of the Linux answer", async () => {
  const host = linuxHost();
  host.bootstrap.capabilities.push("ArdiaApp.postNotification");
  const calls = [];
  host.invoke = async (method) => { calls.push(method); return "n1"; };
  assert.equal(await resolveHostModule(host, "ArdiaApp", "postNotification")({ title: "x" }), "n1");
  assert.deepEqual(calls, ["ArdiaApp.postNotification"]);
});

test("every ArdiaShell method resolves to its Linux fallback while the native host doesn't advertise it", () => {
  for (const name of ["watchLeftEdge", "setDragEscapeCapture", "saveKeyResponder", "raiseView", "animateWindowClose", "dragPreviewBegin"]) {
    assert.equal(resolveHostModule(olderEngine(`ArdiaShell.${name}`), "ArdiaShell", name), linuxShellMethod(name), name);
  }
});

test("reading the clipboard answers empty text on Linux until the native host advertises ArdiaShell.readText", async () => {
  assert.equal(advertised.includes("ArdiaShell.readText"), false);
  assert.equal(await resolveHostModule(linuxHost(), "ArdiaShell", "readText")(), "");
  const host = linuxHost();
  host.bootstrap.capabilities.push("ArdiaShell.readText");
  host.invoke = async (method) => (method === "ArdiaShell.readText" ? "copied" : null);
  assert.equal(await resolveHostModule(host, "ArdiaShell", "readText")(), "copied");
});

test("the native host captures a tab drag's Escape for every window, whatever has keyboard focus", async () => {
  assert.ok(advertised.includes("ArdiaShell.setDragEscapeCapture"));
  const host = linuxHost();
  const calls = [];
  host.invoke = async (method, args) => { calls.push([method, args]); return null; };
  const capture = resolveHostModule(host, "ArdiaShell", "setDragEscapeCapture");
  assert.notEqual(capture, linuxShellMethod("setDragEscapeCapture"));
  await capture(true);
  await capture(false);
  assert.deepEqual(calls, [["ArdiaShell.setDragEscapeCapture", { args: [true] }], ["ArdiaShell.setDragEscapeCapture", { args: [false] }]]);
});

test("a method the native host advertises wins over the Linux fallback", async () => {
  const host = linuxHost();
  const calls = [];
  host.bootstrap.capabilities.push("ArdiaShell.watchLeftEdge");
  host.invoke = async (method, args) => { calls.push([method, args]); return null; };
  await resolveHostModule(host, "ArdiaShell", "watchLeftEdge")("main", true, 0);
  assert.deepEqual(calls, [["ArdiaShell.watchLeftEdge", { args: ["main", true, 0] }]]);
});

function fakeDom() {
  const listeners = new Map();
  const classes = new Set();
  const head = [];
  class HTMLElement {
    constructor(name, parent = null) {
      this.name = name;
      this.parentElement = parent;
      this.children = [];
      this.style = { zIndex: "" };
      this.isConnected = true;
      parent?.children.push(this);
    }
    focus() { dom.document.activeElement = this; }
    getBoundingClientRect() { return { left: 0, top: 0, right: 1920, bottom: 1080 }; }
  }
  const body = new HTMLElement("body");
  const frame = new HTMLElement("window", body);
  const dom = {
    HTMLElement,
    body,
    frame,
    listeners,
    window: {
      addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      removeEventListener: (type, listener) => listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener)),
    },
    document: {
      body,
      activeElement: body,
      fullscreenElement: null,
      focused: true,
      hasFocus: () => dom.document.focused,
      querySelector: (selector) => (selector === ".ardia-window" ? frame : null),
      getElementById: (id) => head.find((style) => style.id === id) ?? null,
      createElement: () => ({ id: "", textContent: "" }),
      head: { append: (style) => head.push(style) },
      documentElement: { classList: { toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)) } },
      addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    },
    getComputedStyle: (element) => ({ zIndex: element.style.zIndex || "auto" }),
    fire: (type, event) => { for (const listener of listeners.get(type) ?? []) listener(event); },
  };
  return dom;
}

function installDom() {
  const dom = fakeDom();
  Object.assign(globalThis, { window: dom.window, document: dom.document, HTMLElement: dom.HTMLElement, getComputedStyle: dom.getComputedStyle });
  return dom;
}

function shellEvents(event) {
  const seen = [];
  const subscription = requireNativeModule("ArdiaShell").addListener(event, (payload) => seen.push(payload));
  return { seen, remove: () => subscription.remove() };
}

test("hiding the sidebar watches the left edge without a native watcher, and a peek's hold keeps it over while the pointer is in the hold", async () => {
  const dom = installDom();
  const events = shellEvents("onWindowEvent");
  const watch = resolveHostModule(linuxHost(), "ArdiaShell", "watchLeftEdge");
  const move = (clientX) => dom.fire("pointermove", { clientX, clientY: 300, shiftKey: false, ctrlKey: false, altKey: false, metaKey: false });
  await watch("main", true, 0);
  assert.deepEqual(events.seen.at(-1), { type: "leftEdge", id: "main", over: false, point: [-1, -1] });
  move(4);
  assert.equal(events.seen.at(-1).over, false);
  await watch("main", true, 230);
  move(4);
  assert.deepEqual(events.seen.at(-1), { type: "leftEdge", id: "main", over: true, point: [4, 300] });
  move(600);
  assert.deepEqual(events.seen.at(-1), { type: "leftEdge", id: "main", over: false, point: [600, 300] });
  await watch("main", false);
  const reported = events.seen.length;
  move(4);
  assert.equal(events.seen.length, reported);
  events.remove();
});

test("on an engine without the native capture, a tab drag captures a bare Escape in the shell as dragEscape and releases it when the drag ends", async () => {
  const dom = installDom();
  const events = shellEvents("onAppEvent");
  const capture = resolveHostModule(olderEngine("ArdiaShell.setDragEscapeCapture"), "ArdiaShell", "setDragEscapeCapture");
  await capture(true);
  const escape = (extra = {}) => {
    const event = { key: "Escape", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, prevented: false, stopped: false, ...extra };
    event.preventDefault = () => { event.prevented = true; };
    event.stopImmediatePropagation = () => { event.stopped = true; };
    dom.fire("keydown", event);
    return event;
  };
  const bare = escape();
  assert.deepEqual(events.seen, [{ type: "dragEscape" }]);
  assert.ok(bare.prevented && bare.stopped);
  assert.equal(escape({ shiftKey: true }).prevented, false);
  await capture(true);
  escape();
  assert.equal(events.seen.length, 2);
  await capture(false);
  escape();
  assert.equal(events.seen.length, 2);
  assert.deepEqual(dom.listeners.get("keydown"), []);
  events.remove();
});

test("the key responder is saved and restored in the shell, and a page-focused window hands focus back to the page", async () => {
  const dom = installDom();
  const host = linuxHost();
  const [save, restore, discard] = ["saveKeyResponder", "restoreKeyResponder", "discardKeyResponder"].map((name) => resolveHostModule(host, "ArdiaShell", name));
  const field = new dom.HTMLElement("field", dom.frame);
  field.focus();
  const token = await save("main");
  assert.ok(token > 0);
  dom.body.focus();
  assert.equal(await restore(token), true);
  assert.equal(dom.document.activeElement, field);
  assert.equal(await restore(token), false);
  const again = await save("main");
  await discard(again);
  assert.equal(await restore(again), false);
  const gone = await save("main");
  field.isConnected = false;
  assert.equal(await restore(gone), false);
  dom.body.focus();
  assert.equal(await save("main"), 0);
  field.isConnected = true;
  field.focus();
  dom.document.focused = false;
  assert.equal(await save("main"), 0);
});

test("raiseView lifts a dragged chip and its parents above their siblings and puts them back", async () => {
  const dom = installDom();
  const raise = resolveHostModule(linuxHost(), "ArdiaShell", "raiseView");
  const strip = new dom.HTMLElement("strip", dom.frame);
  const group = new dom.HTMLElement("group", strip);
  const neighbour = new dom.HTMLElement("neighbour", strip);
  neighbour.style.zIndex = "3";
  const chip = new dom.HTMLElement("chip", group);
  new dom.HTMLElement("other", group);
  await raise(chip, 1, true);
  assert.equal(chip.style.zIndex, "1");
  assert.equal(group.style.zIndex, "4");
  assert.equal(strip.style.zIndex, "");
  await raise(chip, 1, false);
  assert.equal(chip.style.zIndex, "");
  assert.equal(group.style.zIndex, "");
  await raise(null, 0, true);
});

test("window close animations, the drag preview and focus cancellation settle immediately, and unavailable features reject explicitly", async () => {
  const host = linuxHost();
  for (const name of ["animateWindowClose", "dragPreviewBegin", "dragPreviewPage", "dragPreviewUpdate", "dragPreviewPlaceholder", "dragPreviewEnd", "dragPreviewCancel", "cancelFocusMove", "replyToTerminate"]) {
    assert.equal(await resolveHostModule(host, "ArdiaShell", name)(), undefined, name);
  }
  assert.equal(resolveHostModule(host, "ArdiaShell", "switcherPointerMoved")(), false);
  for (const name of ["fetchBangList", "startDictation"]) {
    await assert.rejects(resolveHostModule(host, "ArdiaShell", name)(null), { code: "ERR_UNAVAILABLE" }, name);
  }
});

test("a tab drag's haptic tick settles quietly on Linux, which has no haptics", async () => {
  const host = linuxHost();
  let invoked = false;
  host.invoke = async () => { invoked = true; throw new Error("Unsupported Linux host method: ArdiaSystem.hapticTick"); };
  assert.equal(await resolveHostModule(host, "ArdiaSystem", "hapticTick")(), undefined);
  assert.equal(invoked, false);
});
